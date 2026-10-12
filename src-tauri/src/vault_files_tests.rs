//! @file vault_files_tests.rs
//! @purpose Unit tests exercising the vault file operations in vault_files: canonical_root, inside_vault, list_folders, vault_list_folders, vault_create_note, vault_create_folder, vault_move, validate_trash, vault_trash, list_templates, and vault_list_templates.
//! @functions temp_vault: create a fresh empty directory under the system temp dir; s: convert a path to its string form.
//! @version 1
//! @date 2026-09-14

use super::*;

/// A fresh empty directory under the system temp dir, unique per test.
fn temp_vault(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kdoc-vault-files-{}-{}-{}", name, std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// Convert a path to its string representation.
fn s(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[test]
fn canonical_root_rejects_empty_and_missing() {
    let v = temp_vault("canonical_root_rejects_empty_and_missing");
    assert!(canonical_root("").is_err());
    assert!(canonical_root(&s(&v.join("nope"))).is_err());
    assert!(canonical_root(&s(&v)).is_ok());
    let _ = fs::remove_dir_all(&v);
}

#[test]
fn inside_vault_accepts_a_path_in_the_vault() {
    let v = temp_vault("inside_vault_accepts_a_path_in_the_vault");
    let root = canonical_root(&s(&v)).unwrap();
    assert!(inside_vault(&root, &s(&v.join("a.md"))).is_ok());
    let _ = fs::remove_dir_all(&v);
}

#[test]
fn inside_vault_rejects_the_vault_itself_and_outside() {
    let v = temp_vault("inside_vault_rejects_the_vault_itself_and_outside");
    let root = canonical_root(&s(&v)).unwrap();
    assert!(inside_vault(&root, &s(&v)).is_err());
    let outside = temp_vault("outside");
    assert!(inside_vault(&root, &s(&outside.join("a.md"))).is_err());
    let _ = fs::remove_dir_all(&outside);
    let _ = fs::remove_dir_all(&v);
}

#[test]
fn inside_vault_rejects_parent_components_and_relative_paths() {
    let v = temp_vault("inside_vault_rejects_parent_components_and_relative_paths");
    let root = canonical_root(&s(&v)).unwrap();
    assert!(inside_vault(&root, &format!("{}{}..{}x.md", s(&v), std::path::MAIN_SEPARATOR, std::path::MAIN_SEPARATOR)).is_err());
    assert!(inside_vault(&root, "a.md").is_err());
    let _ = fs::remove_dir_all(&v);
}

#[test]
fn inside_vault_rejects_a_missing_parent_folder() {
    let v = temp_vault("inside_vault_rejects_a_missing_parent_folder");
    let root = canonical_root(&s(&v)).unwrap();
    assert!(inside_vault(&root, &s(&v.join("missing").join("a.md"))).is_err());
    let _ = fs::remove_dir_all(&v);
}

#[test]
fn list_folders_includes_empty_and_nested_folders_and_skips_hidden() {
    let v = temp_vault("list_folders_includes_empty_and_nested_folders_and_skips_hidden");
    fs::create_dir_all(v.join("b").join("inner")).unwrap();
    fs::create_dir(v.join("A")).unwrap();
    fs::create_dir(v.join(".git")).unwrap();
    fs::create_dir_all(v.join(".k-doc").join("templates")).unwrap();
    fs::create_dir(v.join("node_modules")).unwrap();
    fs::write(v.join("note.md"), "x").unwrap();
    assert_eq!(vault_list_folders_at(s(&v)).unwrap(), vec!["A".to_string(), "b".to_string(), "b/inner".to_string()]);
    let _ = fs::remove_dir_all(&v);
}

#[test]
fn create_note_writes_the_contents() {
    let v = temp_vault("create_note_writes_the_contents");
    let p = v.join("new.md");
    assert_eq!(vault_create_note_at(s(&v), s(&p), "# Hi\n".into()).unwrap(), s(&p));
    assert_eq!(fs::read_to_string(&p).unwrap(), "# Hi\n");
    let _ = fs::remove_dir_all(&v);
}

#[test]
fn create_note_refuses_to_overwrite() {
    let v = temp_vault("create_note_refuses_to_overwrite");
    fs::write(v.join("a.md"), "keep").unwrap();
    assert!(vault_create_note_at(s(&v), s(&v.join("a.md")), "new".into()).is_err());
    assert_eq!(fs::read_to_string(v.join("a.md")).unwrap(), "keep");
    let _ = fs::remove_dir_all(&v);
}

#[test]
fn create_note_refuses_a_non_note_extension() {
    let v = temp_vault("create_note_refuses_a_non_note_extension");
    assert!(vault_create_note_at(s(&v), s(&v.join("a.txt")), String::new()).is_err());
    assert!(!v.join("a.txt").exists());
    let _ = fs::remove_dir_all(&v);
}

#[test]
fn create_note_refuses_a_path_outside_the_vault() {
    let v = temp_vault("create_note_refuses_a_path_outside_the_vault");
    let outside = temp_vault("outside-note");
    assert!(vault_create_note_at(s(&v), s(&outside.join("a.md")), String::new()).is_err());
    assert!(!outside.join("a.md").exists());
    let _ = fs::remove_dir_all(&outside);
    let _ = fs::remove_dir_all(&v);
}

#[test]
fn create_folder_creates_and_refuses_existing() {
    let v = temp_vault("create_folder_creates_and_refuses_existing");
    let p = v.join("f");
    assert!(vault_create_folder_at(s(&v), s(&p)).is_ok());
    assert!(p.is_dir());
    assert!(vault_create_folder_at(s(&v), s(&p)).is_err());
    let _ = fs::remove_dir_all(&v);
}

#[test]
fn move_renames_a_note() {
    let v = temp_vault("move_renames_a_note");
    fs::write(v.join("a.md"), "x").unwrap();
    assert_eq!(vault_move_at(s(&v), s(&v.join("a.md")), s(&v.join("b.md"))).unwrap(), s(&v.join("b.md")));
    assert!(!v.join("a.md").exists());
    assert_eq!(fs::read_to_string(v.join("b.md")).unwrap(), "x");
    let _ = fs::remove_dir_all(&v);
}

#[test]
fn move_moves_a_folder_with_its_contents() {
    let v = temp_vault("move_moves_a_folder_with_its_contents");
    fs::create_dir_all(v.join("src")).unwrap();
    fs::write(v.join("src").join("n.md"), "x").unwrap();
    fs::create_dir(v.join("dest")).unwrap();
    vault_move_at(s(&v), s(&v.join("src")), s(&v.join("dest").join("src"))).unwrap();
    assert!(v.join("dest").join("src").join("n.md").is_file());
    let _ = fs::remove_dir_all(&v);
}

#[test]
fn move_refuses_to_overwrite() {
    let v = temp_vault("move_refuses_to_overwrite");
    fs::write(v.join("a.md"), "a").unwrap();
    fs::write(v.join("b.md"), "b").unwrap();
    assert!(vault_move_at(s(&v), s(&v.join("a.md")), s(&v.join("b.md"))).is_err());
    assert_eq!(fs::read_to_string(v.join("b.md")).unwrap(), "b");
    let _ = fs::remove_dir_all(&v);
}

#[test]
fn move_refuses_a_folder_into_itself() {
    let v = temp_vault("move_refuses_a_folder_into_itself");
    fs::create_dir_all(v.join("f").join("g")).unwrap();
    assert!(vault_move_at(s(&v), s(&v.join("f")), s(&v.join("f").join("g").join("f"))).is_err());
    assert!(v.join("f").is_dir());
    let _ = fs::remove_dir_all(&v);
}

#[test]
fn move_allows_a_case_only_rename() {
    let v = temp_vault("move_allows_a_case_only_rename");
    fs::write(v.join("note.md"), "x").unwrap();
    assert!(vault_move_at(s(&v), s(&v.join("note.md")), s(&v.join("Note.md"))).is_ok());
    let names: Vec<String> = fs::read_dir(&v).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
    assert_eq!(names, vec!["Note.md".to_string()]);
    let _ = fs::remove_dir_all(&v);
}

#[test]
fn move_reports_a_missing_source() {
    let v = temp_vault("move_reports_a_missing_source");
    assert!(vault_move_at(s(&v), s(&v.join("gone.md")), s(&v.join("b.md"))).is_err());
    let _ = fs::remove_dir_all(&v);
}

#[test]
fn validate_trash_rejects_empty_missing_outside_and_root() {
    let v = temp_vault("validate_trash_rejects_empty_missing_outside_and_root");
    let root = canonical_root(&s(&v)).unwrap();
    assert!(validate_trash(&root, &[]).is_err());
    assert!(validate_trash(&root, &[s(&v.join("gone.md"))]).is_err());
    assert!(validate_trash(&root, &[s(&v)]).is_err());
    let outside = temp_vault("outside-trash");
    fs::write(outside.join("x.md"), "x").unwrap();
    assert!(validate_trash(&root, &[s(&outside.join("x.md"))]).is_err());
    let _ = fs::remove_dir_all(&outside);
    let _ = fs::remove_dir_all(&v);
}

#[test]
fn validate_trash_accepts_existing_files_and_folders() {
    let v = temp_vault("validate_trash_accepts_existing_files_and_folders");
    fs::write(v.join("a.md"), "x").unwrap();
    fs::create_dir(v.join("f")).unwrap();
    let root = canonical_root(&s(&v)).unwrap();
    assert_eq!(validate_trash(&root, &[s(&v.join("a.md")), s(&v.join("f"))]).unwrap().len(), 2);
    let _ = fs::remove_dir_all(&v);
}

#[test]
#[ignore = "moves a real file into the user's Recycle Bin; run by hand with --ignored"]
fn trash_moves_a_file_to_the_recycle_bin() {
    let v = temp_vault("trash_moves_a_file_to_the_recycle_bin");
    fs::write(v.join("bin-me.md"), "x").unwrap();
    tauri::async_runtime::block_on(vault_trash_at(s(&v), vec![s(&v.join("bin-me.md"))])).unwrap();
    assert!(!v.join("bin-me.md").exists());
    let _ = fs::remove_dir_all(&v);
}

#[test]
fn list_templates_is_empty_without_the_folder() {
    let v = temp_vault("list_templates_is_empty_without_the_folder");
    assert!(list_templates(&v).unwrap().is_empty());
    let _ = fs::remove_dir_all(&v);
}

#[test]
fn list_templates_lists_markdown_files_by_name() {
    let v = temp_vault("list_templates_lists_markdown_files_by_name");
    let t = v.join(".k-doc").join("templates");
    fs::create_dir_all(t.join("sub")).unwrap();
    fs::write(t.join("meeting.md"), "m").unwrap();
    fs::write(t.join("Daily.markdown"), "d").unwrap();
    fs::write(t.join("notes.txt"), "n").unwrap();
    fs::write(t.join("sub").join("deep.md"), "x").unwrap();
    let names: Vec<String> = vault_list_templates_at(s(&v)).unwrap().into_iter().map(|t| t.name).collect();
    assert_eq!(names, vec!["Daily".to_string(), "meeting".to_string()]);
    let _ = fs::remove_dir_all(&v);
}
