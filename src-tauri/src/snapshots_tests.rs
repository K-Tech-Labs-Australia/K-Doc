//! snapshots_tests.rs
//! @purpose unit tests for snapshot keys, names and the folder operations
//! @version 1
//! @date 2026-09-16

use super::*;

/// Build a unique temporary directory keyed by process id, nanos and suffix.
fn temp_dir(suffix: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("kdoc-snapshot-test-{}-{}-{}", std::process::id(), nanos, suffix));
    let _ = fs::create_dir_all(&dir);
    dir
}

/// FNV-1a 64-bit must reproduce the known reference vectors.
#[test]
fn fnv1a64_matches_the_reference_values() {
    assert_eq!(fnv1a64(b""), 0xcbf2_9ce4_8422_2325);
    assert_eq!(fnv1a64(b"a"), 0xaf63_dc4c_8601_ec8c);
}

/// Snapshot keys come from a valid KDOC id or a normalised path hash.
#[test]
fn keys_use_the_kdoc_id_or_a_normalised_path_hash() {
    assert_eq!(snapshot_key(Some("01HZY3G6Q2K8V4M5N6P7R8S9TA"), "C:/x.md").unwrap(), "01HZY3G6Q2K8V4M5N6P7R8S9TA");
    assert!(snapshot_key(Some("01HZY3G6Q2K8V4M5N6P7R8S9TI"), "C:/x.md").is_err());
    assert!(snapshot_key(Some("short"), "C:/x.md").is_err());
    assert!(snapshot_key(Some("01HZY3G6Q2K8V4M5N6P7R8S9T"), "C:/x.md").is_err());
    assert!(snapshot_key(Some("01hzy3g6q2k8v4m5n6p7r8s9ta"), "C:/x.md").is_err());
    let key = snapshot_key(None, "C:\\Notes\\Plan.md").unwrap();
    assert_eq!(key, snapshot_key(None, "c:/notes/plan.md").unwrap());
    assert_eq!(key.len(), 17);
    assert!(key.starts_with('p'));
    assert_ne!(key, snapshot_key(None, "c:/notes/other.md").unwrap());
    assert!(snapshot_key(None, "  ").is_err());
}

/// Snapshot ids must encode a millisecond timestamp and a known reason.
#[test]
fn ids_must_be_time_and_a_known_reason() {
    assert_eq!(parse_snapshot_id("1757980800000-save.md"), Some((1_757_980_800_000, "save".to_string())));
    assert_eq!(parse_snapshot_id("0000000000042-timer.md"), Some((42, "timer".to_string())));
    assert_eq!(parse_snapshot_id("123456789012-save.md"), None);
    assert_eq!(parse_snapshot_id("1757980800000-other.md"), None);
    assert_eq!(parse_snapshot_id("1757980800000-save.tmp"), None);
    assert_eq!(parse_snapshot_id("../1757980800000-save.md"), None);
    assert_eq!(parse_snapshot_id("17579808x0000-save.md"), None);
    assert_eq!(parse_snapshot_id("+757980800000-save.md"), None);
}

/// Writes, lists and reads snapshots in ascending time order.
#[test]
fn writes_list_and_reads_snapshots_in_time_order() {
    let root = temp_dir("write");
    let dir = snapshot_dir(&root, "p0000000000000001");
    assert_eq!(list_snapshots(&dir).unwrap(), Vec::new());
    let second = write_snapshot(&dir, 2_000, "manual", "two").unwrap().unwrap();
    fs::write(dir.join("stray.tmp"), "x").unwrap();
    let first = write_snapshot(&dir, 1_000, "save", "one").unwrap().unwrap();
    assert_eq!(first, SnapshotInfo { id: "0000000001000-save.md".to_string(), at: 1_000, reason: "save".to_string(), bytes: 3 });
    let listed = list_snapshots(&dir).unwrap();
    assert_eq!(listed, vec![first.clone(), second.clone()]);
    assert_eq!(read_snapshot(&dir, &first.id).unwrap(), "one");
    assert!(read_snapshot(&dir, "../secret.md").is_err());
    fs::write(dir.join("..").join("0000000001000-save.md"), "outside").unwrap();
    assert!(read_snapshot(&dir, "../0000000001000-save.md").is_err());
    let _ = fs::remove_dir_all(&root);
}

/// Text identical to the newest snapshot is not written again.
#[test]
fn skips_text_identical_to_the_newest_snapshot() {
    let root = temp_dir("dedupe");
    let dir = snapshot_dir(&root, "p0000000000000002");
    assert!(write_snapshot(&dir, 1_000, "save", "same").unwrap().is_some());
    assert_eq!(write_snapshot(&dir, 2_000, "timer", "same").unwrap(), None);
    assert!(write_snapshot(&dir, 3_000, "save", "changed").unwrap().is_some());
    assert!(write_snapshot(&dir, 4_000, "save", "same").unwrap().is_some());
    assert_eq!(list_snapshots(&dir).unwrap().len(), 3);
    let _ = fs::remove_dir_all(&root);
}

/// A same-millisecond write receives the next stamp.
#[test]
fn gives_a_same_millisecond_snapshot_the_next_stamp() {
    let root = temp_dir("stamp");
    let dir = snapshot_dir(&root, "p0000000000000003");
    write_snapshot(&dir, 5_000, "save", "a").unwrap();
    let next = write_snapshot(&dir, 5_000, "save", "b").unwrap().unwrap();
    assert_eq!(next.at, 5_001);
    assert_eq!(next.id, "0000000005001-save.md");
    assert!(write_snapshot(&dir, 6_000, "bogus", "c").is_err());
    let _ = fs::remove_dir_all(&root);
}

/// Deletes only valid ids and is all-or-nothing on a bad one.
#[test]
fn deletes_only_valid_ids_and_all_or_nothing_on_a_bad_one() {
    let root = temp_dir("delete");
    let dir = snapshot_dir(&root, "p0000000000000004");
    let a = write_snapshot(&dir, 1_000, "save", "a").unwrap().unwrap();
    let b = write_snapshot(&dir, 2_000, "save", "b").unwrap().unwrap();
    assert!(delete_snapshots(&dir, &[a.id.clone(), "../x.md".to_string()]).is_err());
    assert_eq!(list_snapshots(&dir).unwrap().len(), 2);
    assert_eq!(delete_snapshots(&dir, &[a.id.clone(), "0000000009999-save.md".to_string()]).unwrap(), 1);
    assert_eq!(list_snapshots(&dir).unwrap(), vec![b]);
    let _ = fs::remove_dir_all(&root);
}
