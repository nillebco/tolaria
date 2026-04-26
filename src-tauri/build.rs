fn main() {
    println!("cargo:rerun-if-env-changed=GITHUB_REPOSITORY");
    println!("cargo:rerun-if-changed=../.git/config");

    if let Some(repository) = build_repository() {
        println!("cargo:rustc-env=TOLARIA_BUILD_REPOSITORY={repository}");
    }

    // Ensure resource directory exists for the Tauri build.
    // Gitignored and populated by bundle-mcp-server.mjs.
    // Without a placeholder, `tauri build` / `cargo test` fails if the script hasn't run.
    let path = std::path::Path::new("resources/mcp-server");
    if !path.exists() {
        std::fs::create_dir_all(path).ok();
        std::fs::write(path.join(".placeholder"), "").ok();
    }
    tauri_build::build()
}

fn build_repository() -> Option<String> {
    std::env::var("GITHUB_REPOSITORY")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(repository_from_origin_remote)
}

fn repository_from_origin_remote() -> Option<String> {
    let output = std::process::Command::new("git")
        .args(["-C", "..", "config", "--get", "remote.origin.url"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    String::from_utf8(output.stdout)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
