use std::path::{Component, Path, PathBuf};

/// Dossiers ignorés lors du chargement d'un projet (volumineux ou générés).
pub const IGNORED_DIRS: &[&str] = &["node_modules", ".git", "target", "dist", "build", ".next", ".venv", "__pycache__"];
pub const MAX_FILES: usize = 2000;
pub const MAX_FILE_BYTES: u64 = 1024 * 1024;

/// Vérifie que le dossier de travail existe et renvoie son chemin canonique.
pub fn root(workspace: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(workspace);
    if !path.is_absolute() {
        return Err("Le dossier de travail doit être un chemin absolu".into());
    }
    path.canonicalize()
        .map_err(|e| format!("Dossier de travail introuvable : {e}"))
}

/// Résout un chemin relatif au projet en refusant chemins absolus et remontées « .. ».
pub fn resolve(workspace: &str, relative: &str) -> Result<PathBuf, String> {
    let root = root(workspace)?;
    let cleaned = relative.trim().replace('\\', "/");
    let cleaned = cleaned.trim_start_matches('/');
    let mut out = root.clone();
    for component in Path::new(cleaned).components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::ParentDir => return Err(format!("Remontée « .. » refusée : {relative}")),
            Component::RootDir | Component::Prefix(_) => {
                return Err(format!("Chemin absolu refusé : {relative}"))
            }
        }
    }
    if !out.starts_with(&root) {
        return Err(format!("Chemin hors du projet : {relative}"));
    }
    // Refuse les liens symboliques qui sortent du dossier de travail.
    if let Ok(real) = out.canonicalize() {
        if !real.starts_with(&root) {
            return Err(format!("Lien hors du projet refusé : {relative}"));
        }
    }
    Ok(out)
}

/// Chemin relatif « a/b.txt » (séparateurs POSIX) d'un fichier sous la racine.
pub fn relative(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let parts: Vec<String> = rel
        .components()
        .filter_map(|c| match c {
            Component::Normal(p) => Some(p.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuse_les_chemins_dangereux() {
        let dir = std::env::temp_dir();
        let ws = dir.to_string_lossy().to_string();
        assert!(resolve(&ws, "../etc/passwd").is_err());
        assert!(resolve(&ws, "a/../../b").is_err());
        assert!(resolve(&ws, "src/main.rs").is_ok());
        assert!(resolve(&ws, "/index.html").unwrap().starts_with(root(&ws).unwrap()));
        assert!(resolve("relatif", "a").is_err());
    }
}
