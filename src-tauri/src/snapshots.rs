//! @file snapshots.rs
//! @purpose Local version snapshots (FR-11.8): stores whole-document copies under the annotation store's local/snapshots/<key>/ folder, skipping a copy identical to the newest, and lists, reads and deletes them.
//! @inputs document paths, an optional kdoc_id, snapshot text, timestamps, reasons.
//! @outputs snapshot files on disk and SnapshotInfo lists over IPC.
//! @functions
//!   - fnv1a64: 64-bit FNV-1a hash of a byte slice (stable across Rust releases).
//!   - is_kdoc_id: validates a 26-character Crockford base32 (ULID) identifier.
//!   - snapshot_key: derives the store key from an optional kdoc_id or a normalized document path.
//!   - snapshot_dir: builds the local/snapshots/<key> folder under a store root.
//!   - parse_snapshot_id: parses <at>-<reason>.md back into (timestamp, reason).
//!   - list_snapshots: returns SnapshotInfo entries sorted oldest first.
//!   - read_snapshot: reads and returns a snapshot's text after validating its id.
//!   - write_snapshot: writes a new snapshot unless identical to the newest, via temp file + rename.
//!   - delete_snapshots: deletes validated ids, returning the count removed.
//!   - folder_for: resolves the vault/global store snapshots folder for a document.
//!   - snapshot_list / snapshot_read / snapshot_write / snapshot_delete: Tauri IPC commands wrapping the free functions.
//! @dataflow document path -> store root (store::resolve_store_location) + key (kdoc_id or path hash) -> folder -> files named <at>-<reason>.md.
//! @controlflow commands resolve the folder then call the free functions, which validate names so no id can leave the folder.
//! @version 1
//! @date 2026-09-16

use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::store::resolve_store_location;

/// @purpose Per-snapshot metadata returned over IPC and persisted as part of the file name.
/// @inputs None (constructed from a parsed directory entry or a successful write).
/// @outputs A serializable record: id is the file name, at is milliseconds since the Unix epoch, bytes the file size, reason why it was taken.
/// @dataflow Directory entry → SnapshotInfo pushed into the list returned by list_snapshots; write_snapshot builds one on success.
/// @controlflow No branching; a plain data aggregate serialized to camelCase JSON fields (id, at, reason, bytes).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfo {
    pub id: String,
    pub at: u64,
    pub reason: String,
    pub bytes: u64,
}

/// @purpose The set of reasons a snapshot may be taken with; the reason is embedded in every file name.
/// @inputs None.
/// @outputs Four allowed reason strings: save, manual, timer, restore.
/// @dataflow Constant table consumed by write_snapshot validation and parse_snapshot_id.
/// @controlflow Immutable lookup used for membership checks only.
pub const SNAPSHOT_REASONS: [&str; 4] = ["save", "manual", "timer", "restore"];

// 64-bit FNV-1a offset basis (http://www.isthe.com/chongo/tech/comp/fnv/).
const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
// 64-bit FNV-1a prime multiplier.
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

/// @purpose Computes the 64-bit FNV-1a hash of a byte slice, giving a digest stable across platforms and Rust releases.
/// @inputs bytes - the input data to hash (typically a normalized document path).
/// @outputs The 64-bit FNV-1a hash value.
/// @dataflow Input bytes → XOR each into the running hash → multiply by prime with wraparound → final digest.
/// @controlflow Single loop over every byte; no branching, accumulating via wrapping arithmetic to avoid panics on overflow.
pub fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = FNV_OFFSET;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

/// @purpose Validates that a string is a 26-character Crockford base32 (ULID) identifier.
/// @inputs id - the candidate identifier string.
/// @outputs true if exactly 26 valid ULID characters, false otherwise.
/// @dataflow Input string → length check → per-character alphabet check → boolean result.
/// @controlflow Guard clause: fails fast on wrong length, then requires every character to be an ASCII digit or a non-confusing uppercase letter (excluding I, L, O, U).
fn is_kdoc_id(id: &str) -> bool {
    id.len() == 26
        && id
            .chars()
            .all(|c| c.is_ascii_digit() || (c.is_ascii_uppercase() && !matches!(c, 'I' | 'L' | 'O' | 'U')))
}

/// @purpose Derives the stable store key for a document's snapshots.
/// @inputs kdoc_id - an optional 26-char ULID that ties history to the annotation; document_path - the on-disk path used when no kdoc_id is present.
/// @outputs Ok(key) where key is either the kdoc_id or a `p`-prefixed hex hash of the normalized path, or Err with a human-readable message.
/// @dataflow Optional id / raw path → validation/normalization → string key fed to snapshot_dir.
/// @controlflow If a kdoc_id is present it must pass is_kdoc_id (else error); otherwise an empty path errors; else the path is lower-cased with forward slashes and hashed so Windows case differences collapse. Snapshots never add a kdoc_id (FR-6.17 only adds one for annotations), so a moved file without a kdoc_id starts fresh history.
pub fn snapshot_key(kdoc_id: Option<&str>, document_path: &str) -> Result<String, String> {
    if let Some(id) = kdoc_id {
        // A kdoc_id was supplied: only accept a well-formed ULID so history stays tied to the annotation.
        if is_kdoc_id(id) {
            // Valid id: reuse it verbatim as the key so snapshots survive renames.
            Ok(id.to_string())
        } else {
            // Id present but malformed: reject rather than silently fall back to a path hash.
            Err(format!("Invalid kdoc_id '{id}' for snapshots."))
        }
    } else if document_path.trim().is_empty() {
        // No id and no usable path: nothing can be keyed until the document is saved.
        Err("A document must be saved before it can have snapshots.".to_string())
    } else {
        // No kdoc_id: key by a hash of the normalized path (lower-cased, forward slashes) so a moved file starts fresh history.
        let normalized = document_path.replace('\\', "/").to_lowercase();
        Ok(format!("p{:016x}", fnv1a64(normalized.as_bytes())))
    }
}

/// @purpose Builds the on-disk folder that holds one document's snapshots.
/// @inputs root - the store root path; key - the document's snapshot key from snapshot_key.
/// @outputs The PathBuf local/snapshots/<key> under the given root.
/// @dataflow Store root + key → joined path components → target folder.
/// @controlflow Pure path construction, no branching or I/O (local/ is git-ignored in a vault per FR-6.20).
pub fn snapshot_dir(root: &Path, key: &str) -> PathBuf {
    root.join("local").join("snapshots").join(key)
}

/// @purpose Parses a snapshot file name back into its timestamp and reason.
/// @inputs id - the candidate file name such as "1700000000000-save.md".
/// @outputs Some((at, reason)) with at in milliseconds since the Unix epoch and reason one of SNAPSHOT_REASONS, or None if the name is not a valid snapshot id.
/// @dataflow File name → strip .md suffix → split on '-' → validate digit run and reason → (u64, String).
/// @controlflow Chain of guard clauses: missing suffix or separator returns None; fewer than 13 digits or non-digits return None; a reason outside SNAPSHOT_REASONS returns None. The ≥13-digit rule plus the digit-only check reject any path traversal (../) or separators, keeping read/delete inside the folder.
pub fn parse_snapshot_id(id: &str) -> Option<(u64, String)> {
    let stem = id.strip_suffix(".md")?;
    // Split the timestamp from the reason on the single '-' separator.
    let (digits, reason) = stem.split_once('-')?;
    if digits.len() < 13 || !digits.chars().all(|c| c.is_ascii_digit()) {
        // Not a zero-padded millisecond run: reject to block traversal or malformed names.
        return None;
    } else if !SNAPSHOT_REASONS.contains(&reason) {
        // Reason is not one of the allowed values: reject.
        return None;
    } else {
        // Both parts validated: fall through to parse the timestamp.
    }
    let at = digits.parse::<u64>().ok()?;
    Some((at, reason.to_string()))
}

/// @purpose Lists every valid snapshot in a folder as SnapshotInfo entries.
/// @inputs dir - the snapshots folder to scan.
/// @outputs Ok(vec) of SnapshotInfo sorted oldest first (empty if the folder is missing or non-snapshot files are skipped), or Err on directory read failure.
/// @dataflow Directory → iterate entries → parse each name → attach byte size → collect and sort.
/// @controlflow Missing folder short-circuits to an empty list; non-snapshot files (e.g. a stray .tmp) are skipped; results sorted by timestamp then id, oldest first.
pub fn list_snapshots(dir: &Path) -> Result<Vec<SnapshotInfo>, String> {
    if !dir.is_dir() {
        // No folder yet: treat as zero snapshots rather than an error.
        return Ok(Vec::new());
    } else {
        // Folder exists: proceed to enumerate its entries.
    }
    let entries = fs::read_dir(dir).map_err(|err| format!("Failed to list snapshots in '{}': {err}", dir.display()))?;
    let mut infos = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|err| format!("Failed to read a snapshot entry: {err}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some((at, reason)) = parse_snapshot_id(&name) {
            // Recognized snapshot file: capture its size and record it.
            let bytes = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
            infos.push(SnapshotInfo { id: name, at, reason, bytes });
        } else {
            // Not a snapshot file (e.g. leftover .tmp): ignore silently.
        }
    }
    // Oldest first for display; ties broken by full id for determinism.
    infos.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| a.id.cmp(&b.id)));
    Ok(infos)
}

/// @purpose Reads and returns the text of a single snapshot after validating its id.
/// @inputs dir - the snapshots folder; id - the snapshot file name to read.
/// @outputs Ok(text) of the snapshot, or Err if the id is invalid or the file cannot be read.
/// @dataflow id → validation → joined path → file bytes decoded as UTF-8 string.
/// @controlflow Guard clause rejects any unparseable id (blocking traversal); otherwise reads the file directly.
pub fn read_snapshot(dir: &Path, id: &str) -> Result<String, String> {
    if parse_snapshot_id(id).is_none() {
        // Id fails validation: refuse before touching the filesystem to prevent path escape.
        return Err(format!("Invalid snapshot id '{id}'."));
    } else {
        // Id is well-formed: safe to read the file inside the folder.
    }
    fs::read_to_string(dir.join(id)).map_err(|err| format!("Failed to read snapshot '{id}': {err}"))
}

/// @purpose Writes a new whole-document snapshot, skipping it when identical to the newest existing one.
/// @inputs dir - the snapshots folder; at - requested timestamp in milliseconds since the Unix epoch; reason - one of SNAPSHOT_REASONS; contents - the document text to store.
/// @outputs Ok(Some(info)) with the stored id/timestamp/reason/size, Ok(None) when nothing new was written (identical to newest), or Err on invalid input or I/O failure.
/// @dataflow reason validated → existing list read → dedupe check against newest → unique stamp chosen → temp file written and atomically renamed → SnapshotInfo returned.
/// @controlflow Invalid reason errors first; if a newest snapshot exists and its text matches, return None without writing; otherwise create the folder, pick a free millisecond stamp (bumping past collisions), write to a sibling .tmp then rename so a crash never leaves a half-written snapshot.
pub fn write_snapshot(dir: &Path, at: u64, reason: &str, contents: &str) -> Result<Option<SnapshotInfo>, String> {
    if !SNAPSHOT_REASONS.contains(&reason) {
        // Reason not permitted: reject before any filesystem work.
        return Err(format!("Invalid snapshot reason '{reason}'."));
    } else {
        // Valid reason: continue to the dedupe and write steps.
    }
    let existing = list_snapshots(dir)?;
    if let Some(newest) = existing.last() {
        // A previous snapshot exists: compare its text to avoid duplicating unchanged content.
        if read_snapshot(dir, &newest.id)? == contents {
            // Identical to the newest snapshot: skip writing and signal no-op with None.
            return Ok(None);
        } else {
            // Content differs: fall through to write a new snapshot.
        }
    } else {
        // No existing snapshots: nothing to dedupe against, proceed to write.
    }
    fs::create_dir_all(dir).map_err(|err| format!("Failed to create snapshot folder '{}': {err}", dir.display()))?;
    let mut stamp = at;
    let mut id = format!("{stamp:013}-{reason}.md");
    while dir.join(&id).exists() {
        // Timestamp collision with an existing file: advance one millisecond until a free name is found.
        stamp += 1;
        id = format!("{stamp:013}-{reason}.md");
    }
    let temp = dir.join(format!("{stamp:013}-{reason}.tmp"));
    // Write to a sibling .tmp then rename so an interrupted write never leaves a partial snapshot in place.
    let written = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&temp)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, dir.join(&id))
    })();
    if let Err(err) = written {
        // Rename/create failed: clean up the orphaned temp file and surface the error.
        let _ = fs::remove_file(&temp);
        return Err(format!("Failed to write snapshot '{id}': {err}"));
    } else {
        // Write succeeded: report the (possibly bumped) stamp actually used.
    }
    Ok(Some(SnapshotInfo { id, at: stamp, reason: reason.to_string(), bytes: contents.len() as u64 }))
}

/// @purpose Deletes a set of snapshots by id, validating every id before removing anything.
/// @inputs dir - the snapshots folder; ids - the snapshot file names to remove.
/// @outputs Ok(count) of files actually removed (an already-missing id is not an error), or Err if any id is invalid so that one bad id deletes nothing.
/// @dataflow ids → per-id validation → for each valid id, delete the file if present → count and return.
/// @controlflow First pass validates all ids up front and fails fast on the first bad one; second pass removes existing files only (missing ones are skipped), returning how many were removed.
pub fn delete_snapshots(dir: &Path, ids: &[String]) -> Result<u32, String> {
    for id in ids {
        if parse_snapshot_id(id).is_none() {
            // Id fails validation: abort the whole batch so a single bad id deletes nothing.
            return Err(format!("Invalid snapshot id '{id}'."));
        } else {
            // Id is well-formed: continue validating the rest.
        }
    }
    let mut removed = 0;
    for id in ids {
        let path = dir.join(id);
        if path.is_file() {
            // Valid snapshot file present: remove it and count it.
            fs::remove_file(&path).map_err(|err| format!("Failed to delete snapshot '{id}': {err}"))?;
            removed += 1;
        } else {
            // No such file (already gone or not a regular file): skip without erroring.
        }
    }
    Ok(removed)
}

/// @purpose Resolves the snapshots folder for a document within its vault or global store.
/// @inputs app - the Tauri application handle; document_path - the on-disk path of the document; kdoc_id - an optional annotation id that overrides path-based keying.
/// @outputs Ok(PathBuf) pointing at local/snapshots/<key>, or Err from snapshot_key/resolve_store_location.
/// @dataflow (document_path, kdoc_id) → snapshot_key → store root via resolve_store_location → snapshot_dir.
/// @controlflow Pure resolution with no branching beyond the error propagation of its two dependencies.
fn folder_for(app: &tauri::AppHandle, document_path: &str, kdoc_id: Option<&str>) -> Result<PathBuf, String> {
    let key = snapshot_key(kdoc_id, document_path)?;
    let location = resolve_store_location(app, Some(document_path))?;
    Ok(snapshot_dir(&location.root, &key))
}

/// @purpose IPC entry point listing a document's snapshots.
/// @inputs app - the Tauri handle; document_path and kdoc_id identify the document; returns the SnapshotInfo list.
/// @outputs Ok(vec) of SnapshotInfo or Err from folder resolution / listing.
/// @dataflow IPC args → folder_for → list_snapshots → serialized JSON response.
/// @controlflow Thin wrapper: resolve the folder once, delegate to list_snapshots, propagate the result.
#[tauri::command]
pub fn snapshot_list(grants: tauri::State<'_, crate::grants::GrantState>, app: tauri::AppHandle, document_path: String, kdoc_id: Option<String>) -> Result<Vec<SnapshotInfo>, String> {
    // Snapshots belong only to documents the user chose.
    grants.require(&document_path)?;
    list_snapshots(&folder_for(&app, &document_path, kdoc_id.as_deref())?)
}

/// @purpose IPC entry point reading one snapshot's text.
/// @inputs app; document_path and kdoc_id identify the document; id selects the snapshot file.
/// @outputs Ok(text) or Err from folder resolution, id validation, or read failure.
/// @dataflow IPC args → folder_for → read_snapshot → response string.
/// @controlflow Thin wrapper: resolve the folder once, delegate to read_snapshot, propagate the result.
#[tauri::command]
pub fn snapshot_read(grants: tauri::State<'_, crate::grants::GrantState>, app: tauri::AppHandle, document_path: String, kdoc_id: Option<String>, id: String) -> Result<String, String> {
    // Snapshots belong only to documents the user chose.
    grants.require(&document_path)?;
    read_snapshot(&folder_for(&app, &document_path, kdoc_id.as_deref())?, &id)
}

/// @purpose IPC entry point writing a new snapshot.
/// @inputs app; document_path and kdoc_id identify the document; at is the requested timestamp in ms; reason is one of SNAPSHOT_REASONS; contents is the document text.
/// @outputs Ok(Some(info)) on write, Ok(None) when identical to the newest, or Err from validation / I/O.
/// @dataflow IPC args → folder_for → write_snapshot → SnapshotInfo (or None) response.
/// @controlflow Thin wrapper: resolve the folder once, delegate to write_snapshot, propagate the result.
#[tauri::command]
pub fn snapshot_write(
    grants: tauri::State<'_, crate::grants::GrantState>,
    app: tauri::AppHandle,
    document_path: String,
    kdoc_id: Option<String>,
    at: u64,
    reason: String,
    contents: String,
) -> Result<Option<SnapshotInfo>, String> {
    // Snapshots belong only to documents the user chose.
    grants.require(&document_path)?;
    write_snapshot(&folder_for(&app, &document_path, kdoc_id.as_deref())?, at, &reason, &contents)
}

/// @purpose IPC entry point deleting several snapshots.
/// @inputs app; document_path and kdoc_id identify the document; ids are the snapshot file names to remove.
/// @outputs Ok(count) of removed files or Err if any id is invalid (nothing is deleted in that case).
/// @dataflow IPC args → folder_for → delete_snapshots → count response.
/// @controlflow Thin wrapper: resolve the folder once, delegate to delete_snapshots, propagate the result.
#[tauri::command]
pub fn snapshot_delete(grants: tauri::State<'_, crate::grants::GrantState>, app: tauri::AppHandle, document_path: String, kdoc_id: Option<String>, ids: Vec<String>) -> Result<u32, String> {
    // Snapshots belong only to documents the user chose.
    grants.require(&document_path)?;
    delete_snapshots(&folder_for(&app, &document_path, kdoc_id.as_deref())?, &ids)
}

#[cfg(test)]
// Unit tests live in the sibling snapshots_tests.rs module.
#[path = "snapshots_tests.rs"]
mod tests;
