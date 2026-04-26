use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
struct RenameTransaction {
    old_path: String,
    new_path: String,
    backup_path: String,
}

pub(super) struct RenameWorkspace {
    dir: PathBuf,
}

impl RenameWorkspace {
    pub(super) fn new(vault: &Path) -> Result<Self, String> {
        let dir = vault.join(".tolaria-rename-txn");
        fs::create_dir_all(&dir).map_err(|e| {
            format!(
                "Failed to create rename transaction dir {}: {}",
                dir.display(),
                e
            )
        })?;
        Ok(Self { dir })
    }

    pub(super) fn stage_note_content(&self, content: &str) -> Result<NamedTempFile, String> {
        let mut staged = NamedTempFile::new_in(&self.dir)
            .map_err(|e| format!("Failed to create staged rename file: {}", e))?;
        staged
            .write_all(content.as_bytes())
            .map_err(|e| format!("Failed to write staged rename file: {}", e))?;
        staged
            .as_file_mut()
            .sync_all()
            .map_err(|e| format!("Failed to sync staged rename file: {}", e))?;
        Ok(staged)
    }

    pub(super) fn operation<'a>(
        &self,
        old_path: &'a str,
        old_file: &'a Path,
    ) -> RenameOperation<'a> {
        RenameOperation {
            old_path,
            old_file,
            backup_path: self.dir.join(format!("{}.bak", Uuid::new_v4())),
            manifest_path: self.dir.join(format!("{}.json", Uuid::new_v4())),
        }
    }
}

pub(super) struct CommittedRename {
    new_file: PathBuf,
    manifest_path: PathBuf,
    backup_path: PathBuf,
}

impl CommittedRename {
    pub(super) fn new_file(&self) -> &Path {
        &self.new_file
    }
}

impl Drop for CommittedRename {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.backup_path);
        let _ = fs::remove_file(&self.manifest_path);
    }
}

pub(super) struct RenameOperation<'a> {
    old_path: &'a str,
    old_file: &'a Path,
    backup_path: PathBuf,
    manifest_path: PathBuf,
}

impl<'a> RenameOperation<'a> {
    pub(super) fn rename_with_candidates(
        &self,
        staged: NamedTempFile,
        desired_filename: &str,
        parent_dir: &Path,
    ) -> Result<CommittedRename, String> {
        let mut staged = staged;
        for attempt in 0.. {
            let candidate = parent_dir.join(candidate_filename(desired_filename, attempt));
            self.prepare(&candidate)?;

            match staged.persist_noclobber(&candidate) {
                Ok(_) => return Ok(self.committed(candidate)),
                Err(err) if err.error.kind() == ErrorKind::AlreadyExists => {
                    staged = err.file;
                    self.rollback()?;
                }
                Err(err) => {
                    self.rollback()?;
                    return Err(format!(
                        "Failed to create {}: {}",
                        candidate.display(),
                        err.error
                    ));
                }
            }
        }
        unreachable!()
    }

    pub(super) fn rename_exact(
        &self,
        staged: NamedTempFile,
        new_file: &Path,
    ) -> Result<CommittedRename, String> {
        self.prepare(new_file)?;
        match staged.persist_noclobber(new_file) {
            Ok(_) => Ok(self.committed(new_file.to_path_buf())),
            Err(err) if err.error.kind() == ErrorKind::AlreadyExists => {
                self.rollback()?;
                Err("A note with that name already exists".to_string())
            }
            Err(err) => {
                self.rollback()?;
                Err(format!(
                    "Failed to rename {} to {}: {}",
                    self.old_path,
                    new_file.to_string_lossy(),
                    err.error
                ))
            }
        }
    }

    fn prepare(&self, new_file: &Path) -> Result<(), String> {
        self.write_manifest(new_file)?;
        self.move_into_backup()
    }

    fn write_manifest(&self, new_file: &Path) -> Result<(), String> {
        let transaction = RenameTransaction {
            old_path: self.old_path.to_string(),
            new_path: new_file.to_string_lossy().to_string(),
            backup_path: self.backup_path.to_string_lossy().to_string(),
        };
        let data = serde_json::to_string(&transaction)
            .map_err(|e| format!("Failed to serialize rename transaction: {}", e))?;
        fs::write(&self.manifest_path, data).map_err(|e| {
            format!(
                "Failed to write rename transaction {}: {}",
                self.manifest_path.display(),
                e
            )
        })
    }

    fn move_into_backup(&self) -> Result<(), String> {
        fs::rename(self.old_file, &self.backup_path).map_err(|e| {
            format!(
                "Failed to move {} into rename backup {}: {}",
                self.old_file.display(),
                self.backup_path.display(),
                e
            )
        })
    }

    fn rollback(&self) -> Result<(), String> {
        if self.backup_path.exists() {
            if let Some(parent) = self.old_file.parent() {
                let _ = fs::create_dir_all(parent);
            }
            fs::rename(&self.backup_path, self.old_file).map_err(|e| {
                format!(
                    "Failed to restore {} from {}: {}",
                    self.old_file.display(),
                    self.backup_path.display(),
                    e
                )
            })?;
        }
        let _ = fs::remove_file(&self.manifest_path);
        Ok(())
    }

    fn committed(&self, new_file: PathBuf) -> CommittedRename {
        CommittedRename {
            new_file,
            manifest_path: self.manifest_path.clone(),
            backup_path: self.backup_path.clone(),
        }
    }
}

fn candidate_filename(filename: &str, attempt: usize) -> String {
    let stem = Path::new(filename)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = Path::new(filename)
        .extension()
        .map(|s| format!(".{}", s.to_string_lossy()))
        .unwrap_or_default();
    if attempt == 0 {
        return filename.to_string();
    }
    format!("{}-{}{}", stem, attempt + 1, ext)
}

fn transaction_dir(vault: &Path) -> PathBuf {
    vault.join(".tolaria-rename-txn")
}

pub(super) fn recover_pending_rename_transactions(vault: &Path) -> Result<(), String> {
    let txn_dir = transaction_dir(vault);
    if !txn_dir.exists() {
        return Ok(());
    }

    let entries = fs::read_dir(&txn_dir).map_err(|e| {
        format!(
            "Failed to read rename transaction dir {}: {}",
            txn_dir.display(),
            e
        )
    })?;

    for entry in entries {
        let path = entry
            .map_err(|e| format!("Failed to read rename transaction entry: {}", e))?
            .path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }

        let Ok(data) = fs::read_to_string(&path) else {
            let _ = fs::remove_file(&path);
            continue;
        };
        let Ok(transaction) = serde_json::from_str::<RenameTransaction>(&data) else {
            let _ = fs::remove_file(&path);
            continue;
        };
        recover_rename_transaction(&path, transaction)?;
    }

    Ok(())
}

fn recover_rename_transaction(
    manifest_path: &Path,
    transaction: RenameTransaction,
) -> Result<(), String> {
    let old_path = Path::new(&transaction.old_path);
    let new_path = Path::new(&transaction.new_path);
    let backup_path = Path::new(&transaction.backup_path);

    if !backup_path.exists() {
        let _ = fs::remove_file(manifest_path);
        return Ok(());
    }

    if new_path.exists() || old_path.exists() {
        let _ = fs::remove_file(backup_path);
        let _ = fs::remove_file(manifest_path);
        return Ok(());
    }

    if let Some(parent) = old_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::rename(backup_path, old_path).map_err(|e| {
        format!(
            "Failed to recover {} from {}: {}",
            old_path.display(),
            backup_path.display(),
            e
        )
    })?;
    let _ = fs::remove_file(manifest_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_manifest(path: &Path, transaction: &RenameTransaction) {
        let data = serde_json::to_string(transaction).expect("serialize transaction");
        fs::write(path, data).expect("write manifest");
    }

    #[test]
    fn candidate_filename_adds_suffix_before_extension() {
        assert_eq!(candidate_filename("note.md", 0), "note.md");
        assert_eq!(candidate_filename("note.md", 1), "note-2.md");
        assert_eq!(candidate_filename("note", 2), "note-3");
    }

    #[test]
    fn staged_note_content_is_written_inside_workspace() {
        let dir = tempfile::tempdir().expect("tempdir");
        let workspace = RenameWorkspace::new(dir.path()).expect("workspace");

        let staged = workspace
            .stage_note_content("# Renamed\n")
            .expect("stage content");

        assert!(staged
            .path()
            .starts_with(dir.path().join(".tolaria-rename-txn")));
        assert_eq!(
            fs::read_to_string(staged.path()).expect("read staged"),
            "# Renamed\n"
        );
    }

    #[test]
    fn rename_with_candidates_uses_next_available_filename() {
        let dir = tempfile::tempdir().expect("tempdir");
        let old_file = dir.path().join("old.md");
        fs::write(&old_file, "# Old\n").expect("write old");
        fs::write(dir.path().join("new.md"), "# Existing\n").expect("write existing");
        let workspace = RenameWorkspace::new(dir.path()).expect("workspace");
        let staged = workspace
            .stage_note_content("# New\n")
            .expect("stage content");
        let operation = workspace.operation("old.md", &old_file);

        let committed = operation
            .rename_with_candidates(staged, "new.md", dir.path())
            .expect("rename with suffix");

        assert_eq!(committed.new_file(), dir.path().join("new-2.md"));
        assert!(!old_file.exists());
        assert_eq!(
            fs::read_to_string(dir.path().join("new.md")).expect("read existing"),
            "# Existing\n"
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("new-2.md")).expect("read renamed"),
            "# New\n"
        );
    }

    #[test]
    fn rename_exact_rolls_back_when_destination_exists() {
        let dir = tempfile::tempdir().expect("tempdir");
        let old_file = dir.path().join("old.md");
        let existing_file = dir.path().join("existing.md");
        fs::write(&old_file, "# Old\n").expect("write old");
        fs::write(&existing_file, "# Existing\n").expect("write existing");
        let workspace = RenameWorkspace::new(dir.path()).expect("workspace");
        let staged = workspace
            .stage_note_content("# New\n")
            .expect("stage content");
        let operation = workspace.operation("old.md", &old_file);

        let err = match operation.rename_exact(staged, &existing_file) {
            Ok(_) => panic!("destination should conflict"),
            Err(err) => err,
        };

        assert_eq!(err, "A note with that name already exists");
        assert_eq!(
            fs::read_to_string(&old_file).expect("old restored"),
            "# Old\n"
        );
        assert_eq!(
            fs::read_to_string(&existing_file).expect("existing untouched"),
            "# Existing\n"
        );
    }

    #[test]
    fn recover_pending_rename_transactions_restores_backup_when_paths_are_missing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let txn_dir = transaction_dir(dir.path());
        fs::create_dir_all(&txn_dir).expect("txn dir");
        let old_path = dir.path().join("notes").join("old.md");
        let new_path = dir.path().join("notes").join("new.md");
        let backup_path = txn_dir.join("backup.bak");
        let manifest_path = txn_dir.join("restore.json");
        fs::write(&backup_path, "# Backup\n").expect("write backup");
        write_manifest(
            &manifest_path,
            &RenameTransaction {
                old_path: old_path.to_string_lossy().to_string(),
                new_path: new_path.to_string_lossy().to_string(),
                backup_path: backup_path.to_string_lossy().to_string(),
            },
        );

        recover_pending_rename_transactions(dir.path()).expect("recover");

        assert_eq!(
            fs::read_to_string(&old_path).expect("restored old"),
            "# Backup\n"
        );
        assert!(!backup_path.exists());
        assert!(!manifest_path.exists());
    }

    #[test]
    fn recover_pending_rename_transactions_cleans_invalid_or_completed_manifests() {
        let dir = tempfile::tempdir().expect("tempdir");
        let txn_dir = transaction_dir(dir.path());
        fs::create_dir_all(&txn_dir).expect("txn dir");

        let invalid_manifest = txn_dir.join("invalid.json");
        fs::write(&invalid_manifest, "not json").expect("write invalid manifest");

        let missing_backup_manifest = txn_dir.join("missing-backup.json");
        let missing_backup = txn_dir.join("missing.bak");
        write_manifest(
            &missing_backup_manifest,
            &RenameTransaction {
                old_path: dir.path().join("old.md").to_string_lossy().to_string(),
                new_path: dir.path().join("new.md").to_string_lossy().to_string(),
                backup_path: missing_backup.to_string_lossy().to_string(),
            },
        );

        let completed_manifest = txn_dir.join("completed.json");
        let completed_backup = txn_dir.join("completed.bak");
        let completed_new = dir.path().join("completed-new.md");
        fs::write(&completed_backup, "# Backup\n").expect("write completed backup");
        fs::write(&completed_new, "# New\n").expect("write completed new");
        write_manifest(
            &completed_manifest,
            &RenameTransaction {
                old_path: dir
                    .path()
                    .join("completed-old.md")
                    .to_string_lossy()
                    .to_string(),
                new_path: completed_new.to_string_lossy().to_string(),
                backup_path: completed_backup.to_string_lossy().to_string(),
            },
        );

        recover_pending_rename_transactions(dir.path()).expect("recover");

        assert!(!invalid_manifest.exists());
        assert!(!missing_backup_manifest.exists());
        assert!(!completed_manifest.exists());
        assert!(!completed_backup.exists());
        assert_eq!(
            fs::read_to_string(&completed_new).expect("new remains"),
            "# New\n"
        );
    }
}
