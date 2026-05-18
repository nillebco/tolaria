use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Check if a character is safe for use in filenames (alphanumeric, dot, dash, underscore).
fn is_safe_filename_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '.' | '-' | '_')
}

/// Sanitize a filename by replacing unsafe characters with underscores.
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| if is_safe_filename_char(c) { c } else { '_' })
        .collect()
}

/// Image file extensions considered valid for drag-drop import.
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "tiff"];
const DEFAULT_ATTACHMENTS_DIR: &str = "attachments";

#[derive(serde::Deserialize)]
struct ObsidianAppConfig {
    #[serde(rename = "attachmentFolderPath")]
    attachment_folder_path: Option<String>,
}

fn safe_vault_relative_path(path: &str) -> Option<PathBuf> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed == "/" {
        return Some(PathBuf::new());
    }

    let normalized = trimmed.trim_start_matches('/').replace('\\', "/");
    let relative_path = Path::new(&normalized);
    let mut safe_path = PathBuf::new();
    for component in relative_path.components() {
        match component {
            Component::Normal(segment) => safe_path.push(segment),
            Component::CurDir => {}
            _ => return None,
        }
    }

    Some(safe_path)
}

fn current_note_relative_path(path: &str) -> Option<&str> {
    let trimmed = path.trim();
    if trimmed == "." || trimmed == "./" || trimmed == ".\\" {
        return Some("");
    }
    trimmed
        .strip_prefix("./")
        .or_else(|| trimmed.strip_prefix(".\\"))
}

fn note_parent_dir(vault_path: &Path, note_path: Option<&str>) -> Result<Option<PathBuf>, String> {
    let Some(raw_note_path) = note_path.map(str::trim).filter(|path| !path.is_empty()) else {
        return Ok(None);
    };

    let requested_note = if Path::new(raw_note_path).is_absolute() {
        PathBuf::from(raw_note_path)
    } else {
        let relative_note = safe_vault_relative_path(raw_note_path)
            .ok_or_else(|| "Active note path must stay inside the active vault".to_string())?;
        vault_path.join(relative_note)
    };

    let canonical_vault = vault_path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve vault path: {}", e))?;
    let canonical_note = requested_note
        .canonicalize()
        .map_err(|e| format!("Failed to resolve active note path: {}", e))?;
    if !canonical_note.starts_with(&canonical_vault) {
        return Err("Active note path must stay inside the active vault".to_string());
    }

    Ok(requested_note.parent().map(Path::to_path_buf))
}

fn configured_attachment_dir(
    vault_path: &Path,
    setting: &str,
    note_path: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    if let Some(relative_to_note) = current_note_relative_path(setting) {
        let Some(note_dir) = note_parent_dir(vault_path, note_path)? else {
            return Ok(None);
        };
        let relative_path = if relative_to_note.is_empty() {
            PathBuf::new()
        } else {
            safe_vault_relative_path(relative_to_note).ok_or_else(|| {
                "Obsidian attachment folder must stay inside the active vault".to_string()
            })?
        };
        return Ok(Some(note_dir.join(relative_path)));
    }

    Ok(safe_vault_relative_path(setting).map(|relative| vault_path.join(relative)))
}

fn obsidian_attachment_dir(
    vault_path: &Path,
    note_path: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let config_path = vault_path.join(".obsidian").join("app.json");
    if !config_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read Obsidian app config: {}", e))?;
    let config: ObsidianAppConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse Obsidian app config: {}", e))?;
    match config.attachment_folder_path.as_deref() {
        Some(setting) => configured_attachment_dir(vault_path, setting, note_path),
        None => Ok(None),
    }
}

fn existing_attachments_dir(vault_path: &Path) -> Result<Option<std::path::PathBuf>, String> {
    let entries = match fs::read_dir(vault_path) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Failed to read vault directory: {}", error)),
    };

    let mut candidates = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read vault entry: {}", e))?;
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        if file_name.eq_ignore_ascii_case(DEFAULT_ATTACHMENTS_DIR) && entry.path().is_dir() {
            candidates.push(entry.path());
        }
    }

    candidates.sort_by_key(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .map(|name| (name != DEFAULT_ATTACHMENTS_DIR, name.to_string()))
            .unwrap_or((true, String::new()))
    });
    Ok(candidates.into_iter().next())
}

fn attachments_dir(
    vault_path: &str,
    note_path: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    let vault = Path::new(vault_path);
    if let Some(configured_dir) = obsidian_attachment_dir(vault, note_path)? {
        return Ok(configured_dir);
    }

    Ok(existing_attachments_dir(vault)?.unwrap_or_else(|| vault.join(DEFAULT_ATTACHMENTS_DIR)))
}

/// Prepare the attachments directory and generate a unique target path.
fn prepare_attachment_path(
    vault_path: &str,
    filename: &str,
    note_path: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    let attachments_dir = attachments_dir(vault_path, note_path)?;
    fs::create_dir_all(&attachments_dir)
        .map_err(|e| format!("Failed to create attachments directory: {}", e))?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let unique_name = format!("{}-{}", timestamp, sanitize_filename(filename));
    Ok(attachments_dir.join(unique_name))
}

/// Save an uploaded image to the vault's attachments directory.
/// Returns the absolute path to the saved file.
pub fn save_image(
    vault_path: &str,
    filename: &str,
    data: &str,
    note_path: Option<&str>,
) -> Result<String, String> {
    use base64::Engine;

    let target_path = prepare_attachment_path(vault_path, filename, note_path)?;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("Invalid base64 data: {}", e))?;

    fs::write(&target_path, bytes).map_err(|e| format!("Failed to write image: {}", e))?;

    Ok(target_path.to_string_lossy().to_string())
}

/// Copy an image file from a source path into the vault's attachments directory.
/// Used for Tauri native drag-drop which provides absolute file paths.
/// Returns the absolute path to the saved file.
pub fn copy_image_to_vault(
    vault_path: &str,
    source_path: &str,
    note_path: Option<&str>,
) -> Result<String, String> {
    let source = Path::new(source_path);
    if !source.exists() {
        return Err(format!("Source file does not exist: {}", source_path));
    }

    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("Not a supported image format: {}", source_path));
    }

    let filename = source
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("image");
    let target_path = prepare_attachment_path(vault_path, filename, note_path)?;

    fs::copy(source, &target_path).map_err(|e| format!("Failed to copy image: {}", e))?;

    Ok(target_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_sanitize_filename_safe_chars() {
        assert_eq!(sanitize_filename("photo.png"), "photo.png");
        assert_eq!(sanitize_filename("my-image_01.jpg"), "my-image_01.jpg");
    }

    #[test]
    fn test_sanitize_filename_unsafe_chars() {
        assert_eq!(sanitize_filename("my file (1).png"), "my_file__1_.png");
        assert_eq!(sanitize_filename("path/to/img.png"), "path_to_img.png");
    }

    #[test]
    fn test_save_image_creates_file() {
        use base64::Engine;

        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();
        let data = base64::engine::general_purpose::STANDARD.encode(b"fake image data");

        let result = save_image(vault_path, "test.png", &data, None);
        assert!(result.is_ok());

        let saved_path = result.unwrap();
        assert!(std::path::Path::new(&saved_path).exists());
        assert!(saved_path.contains("attachments"));
        assert!(saved_path.contains("test.png"));

        let content = fs::read(&saved_path).unwrap();
        assert_eq!(content, b"fake image data");
    }

    #[test]
    fn test_save_image_creates_attachments_dir() {
        use base64::Engine;

        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();
        let attachments = dir.path().join("attachments");
        assert!(!attachments.exists());

        let data = base64::engine::general_purpose::STANDARD.encode(b"test");
        save_image(vault_path, "img.png", &data, None).unwrap();
        assert!(attachments.exists());
    }

    #[test]
    fn test_save_image_preserves_existing_attachments_dir_casing() {
        use base64::Engine;

        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();
        let attachments = dir.path().join("Attachments");
        fs::create_dir_all(&attachments).unwrap();

        let data = base64::engine::general_purpose::STANDARD.encode(b"test");
        let saved_path = save_image(vault_path, "img.png", &data, None).unwrap();

        assert!(saved_path.contains("Attachments"));
        assert!(std::path::Path::new(&saved_path).exists());
        assert_eq!(
            std::path::Path::new(&saved_path)
                .parent()
                .and_then(|path| path.file_name())
                .and_then(|name| name.to_str()),
            Some("Attachments"),
        );
    }

    #[test]
    fn test_save_image_uses_obsidian_attachment_folder_path() {
        use base64::Engine;

        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();
        fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        fs::write(
            dir.path().join(".obsidian").join("app.json"),
            r#"{"attachmentFolderPath":"Media/Inbox"}"#,
        )
        .unwrap();

        let data = base64::engine::general_purpose::STANDARD.encode(b"test");
        let saved_path = save_image(vault_path, "img.png", &data, None).unwrap();

        assert!(saved_path.contains("Media/Inbox"));
        assert!(std::path::Path::new(&saved_path).exists());
        assert!(!dir.path().join("attachments").exists());
    }

    #[test]
    fn test_save_image_uses_vault_root_for_obsidian_root_attachment_path() {
        use base64::Engine;

        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();
        fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        fs::write(
            dir.path().join(".obsidian").join("app.json"),
            r#"{"attachmentFolderPath":"/"}"#,
        )
        .unwrap();

        let data = base64::engine::general_purpose::STANDARD.encode(b"test");
        let saved_path = save_image(vault_path, "img.png", &data, None).unwrap();

        assert!(std::path::Path::new(&saved_path).exists());
        assert!(std::path::Path::new(&saved_path)
            .parent()
            .unwrap()
            .ends_with(dir.path()));
        assert!(!dir.path().join("attachments").exists());
    }

    #[test]
    fn test_save_image_uses_current_note_folder_for_obsidian_dot_attachment_path() {
        use base64::Engine;

        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();
        let note_path = dir.path().join("Daily").join("2026-05-18.md");
        fs::create_dir_all(note_path.parent().unwrap()).unwrap();
        fs::write(&note_path, "# Daily").unwrap();
        fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        fs::write(
            dir.path().join(".obsidian").join("app.json"),
            r#"{"attachmentFolderPath":"./"}"#,
        )
        .unwrap();

        let data = base64::engine::general_purpose::STANDARD.encode(b"test");
        let saved_path = save_image(
            vault_path,
            "img.png",
            &data,
            Some(note_path.to_str().unwrap()),
        )
        .unwrap();

        assert!(std::path::Path::new(&saved_path).exists());
        assert!(std::path::Path::new(&saved_path)
            .parent()
            .unwrap()
            .ends_with(dir.path().join("Daily")));
        assert!(!dir.path().join("attachments").exists());
    }

    #[test]
    fn test_save_image_uses_current_note_subfolder_for_obsidian_relative_attachment_path() {
        use base64::Engine;

        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();
        let note_path = dir.path().join("Projects").join("Plan.md");
        fs::create_dir_all(note_path.parent().unwrap()).unwrap();
        fs::write(&note_path, "# Plan").unwrap();
        fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        fs::write(
            dir.path().join(".obsidian").join("app.json"),
            r#"{"attachmentFolderPath":"./assets"}"#,
        )
        .unwrap();

        let data = base64::engine::general_purpose::STANDARD.encode(b"test");
        let saved_path = save_image(
            vault_path,
            "img.png",
            &data,
            Some(note_path.to_str().unwrap()),
        )
        .unwrap();

        assert!(std::path::Path::new(&saved_path).exists());
        assert!(std::path::Path::new(&saved_path)
            .parent()
            .unwrap()
            .ends_with(dir.path().join("Projects").join("assets")));
    }

    #[test]
    fn test_save_image_invalid_base64() {
        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();

        let result = save_image(vault_path, "test.png", "not-valid-base64!!!", None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid base64"));
    }

    #[test]
    fn test_copy_image_to_vault_success() {
        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();

        // Create a source image file
        let source_path = dir.path().join("source.png");
        fs::write(&source_path, b"fake png data").unwrap();

        let result = copy_image_to_vault(vault_path, source_path.to_str().unwrap(), None);
        assert!(result.is_ok());

        let saved_path = result.unwrap();
        assert!(std::path::Path::new(&saved_path).exists());
        assert!(saved_path.contains("attachments"));
        assert!(saved_path.contains("source.png"));

        let content = fs::read(&saved_path).unwrap();
        assert_eq!(content, b"fake png data");
    }

    #[test]
    fn test_copy_image_to_vault_nonexistent_source() {
        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();

        let result = copy_image_to_vault(vault_path, "/nonexistent/photo.png", None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn test_copy_image_to_vault_rejects_non_image() {
        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();

        let source_path = dir.path().join("document.pdf");
        fs::write(&source_path, b"fake pdf").unwrap();

        let result = copy_image_to_vault(vault_path, source_path.to_str().unwrap(), None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Not a supported image"));
    }

    #[test]
    fn test_copy_image_to_vault_accepts_all_extensions() {
        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();

        for ext in &["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "tiff"] {
            let source_path = dir.path().join(format!("img.{}", ext));
            fs::write(&source_path, b"data").unwrap();
            let result = copy_image_to_vault(vault_path, source_path.to_str().unwrap(), None);
            assert!(result.is_ok(), "failed for extension: {}", ext);
        }
    }
}
