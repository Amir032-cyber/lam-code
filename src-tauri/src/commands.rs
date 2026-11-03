use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::policy::check_command;
use crate::workspace::{relative, resolve, root, IGNORED_DIRS, MAX_FILES, MAX_FILE_BYTES};

const KEYRING_SERVICE: &str = "lam-code";
const DEFAULT_TIMEOUT_MS: u64 = 120_000;
const DEFAULT_MAX_OUTPUT: usize = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VFile {
    path: String,
    content: String,
    encoding: &'static str,
    mime: String,
    size: u64,
    updated_at: u64,
}

#[derive(Serialize)]
pub struct ProjectFiles {
    files: Vec<VFile>,
    dirs: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    exit_code: i32,
    stdout: String,
    stderr: String,
    duration_ms: u64,
}

#[derive(Serialize, Clone)]
struct OutputEvent {
    id: String,
    stream: &'static str,
    data: String,
}

struct Running {
    child: Mutex<Child>,
    cancelled: AtomicBool,
}

#[derive(Default)]
pub struct Processes(Mutex<HashMap<String, Arc<Running>>>);

fn mime_for(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" | "cjs" | "jsx" => "text/javascript",
        "ts" | "tsx" => "text/typescript",
        "json" => "application/json",
        "md" => "text/markdown",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "wasm" => "application/wasm",
        _ => "text/plain",
    }
}

fn now_ms(time: Option<SystemTime>) -> u64 {
    time.unwrap_or_else(SystemTime::now)
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn walk(root: &Path, dir: &Path, out: &mut ProjectFiles) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("Lecture impossible de {}: {e}", dir.display()))?;
    for entry in entries.flatten() {
        if out.files.len() >= MAX_FILES {
            return Ok(());
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.file_type().is_symlink() {
            continue;
        }
        let Some(rel) = relative(root, &path) else { continue };
        if meta.is_dir() {
            if IGNORED_DIRS.contains(&name.as_str()) {
                continue;
            }
            out.dirs.push(rel);
            walk(root, &path, out)?;
        } else if meta.is_file() && meta.len() <= MAX_FILE_BYTES {
            let Ok(bytes) = fs::read(&path) else { continue };
            let (content, encoding) = match String::from_utf8(bytes) {
                Ok(text) if !text.contains('\0') => (text, "utf8"),
                Ok(text) => (base64::engine::general_purpose::STANDARD.encode(text.as_bytes()), "base64"),
                Err(err) => (base64::engine::general_purpose::STANDARD.encode(err.as_bytes()), "base64"),
            };
            out.files.push(VFile {
                mime: mime_for(&rel).to_string(),
                path: rel,
                content,
                encoding,
                size: meta.len(),
                updated_at: now_ms(meta.modified().ok()),
            });
        }
    }
    Ok(())
}

/// Charge les fichiers du dossier de travail (hors node_modules, .git, target…).
#[tauri::command]
pub fn fs_load(workspace: String) -> Result<ProjectFiles, String> {
    let root = root(&workspace)?;
    let mut out = ProjectFiles { files: Vec::new(), dirs: Vec::new() };
    walk(&root, &root, &mut out)?;
    Ok(out)
}

#[tauri::command]
pub fn fs_write(workspace: String, path: String, content: String, encoding: String) -> Result<(), String> {
    let target = resolve(&workspace, &path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = if encoding == "base64" {
        base64::engine::general_purpose::STANDARD
            .decode(content.as_bytes())
            .map_err(|e| format!("Contenu base64 invalide : {e}"))?
    } else {
        content.into_bytes()
    };
    fs::write(&target, bytes).map_err(|e| format!("Écriture impossible : {e}"))
}

#[tauri::command]
pub fn fs_remove(workspace: String, path: String) -> Result<(), String> {
    let target = resolve(&workspace, &path)?;
    if target == root(&workspace)? {
        return Err("Suppression du dossier de travail refusée".into());
    }
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| e.to_string())
    } else if target.exists() {
        fs::remove_file(&target).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn fs_rename(workspace: String, from: String, to: String) -> Result<(), String> {
    let source = resolve(&workspace, &from)?;
    let dest = resolve(&workspace, &to)?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(source, dest).map_err(|e| format!("Renommage impossible : {e}"))
}

#[tauri::command]
pub fn fs_mkdir(workspace: String, path: String) -> Result<(), String> {
    fs::create_dir_all(resolve(&workspace, &path)?).map_err(|e| e.to_string())
}

fn shell(cmd: &str) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut command = Command::new("powershell.exe");
        command
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"])
            .arg(format!("[Console]::OutputEncoding=[Text.Encoding]::UTF8; {cmd}"))
            .creation_flags(CREATE_NO_WINDOW);
        command
    }
    #[cfg(not(windows))]
    {
        let mut command = Command::new("sh");
        command.arg("-c").arg(cmd);
        command
    }
}

fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &child.id().to_string()])
            .creation_flags(0x0800_0000)
            .status();
    }
    let _ = child.kill();
}

fn pump(
    app: AppHandle,
    id: String,
    stream: &'static str,
    mut source: impl Read + Send + 'static,
    buffer: Arc<Mutex<(String, usize)>>,
    limit: usize,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut chunk = [0u8; 8192];
        loop {
            let read = match source.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            let text = String::from_utf8_lossy(&chunk[..read]).into_owned();
            let mut guard = buffer.lock().expect("verrou de sortie");
            let remaining = limit.saturating_sub(guard.1);
            if remaining == 0 {
                continue;
            }
            let mut kept = text;
            if kept.len() > remaining {
                let mut cut = remaining;
                while !kept.is_char_boundary(cut) {
                    cut -= 1;
                }
                kept.truncate(cut);
                kept.push_str("\n[… sortie tronquée à 1 Mo]");
            }
            guard.1 += kept.len();
            guard.0.push_str(&kept);
            drop(guard);
            let _ = app.emit("cmd-output", OutputEvent { id: id.clone(), stream, data: kept });
        }
    })
}

/// Exécute une commande PowerShell dans le dossier de travail : streaming, timeout, annulation.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn run_command(
    app: AppHandle,
    processes: State<'_, Processes>,
    id: String,
    cmd: String,
    cwd: Option<String>,
    workspace: String,
    timeout_ms: Option<u64>,
    max_output_bytes: Option<usize>,
) -> Result<CommandResult, String> {
    check_command(&cmd)?;
    let dir = resolve(&workspace, cwd.as_deref().unwrap_or(""))?;
    if !dir.is_dir() {
        return Err(format!("Dossier introuvable : {}", cwd.unwrap_or_default()));
    }
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).min(30 * 60_000));
    let limit = max_output_bytes.unwrap_or(DEFAULT_MAX_OUTPUT).min(DEFAULT_MAX_OUTPUT);

    let mut child = shell(&cmd)
        .current_dir(&dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Impossible de lancer le shell : {e}"))?;

    let started = Instant::now();
    let stdout_buf = Arc::new(Mutex::new((String::new(), 0usize)));
    let stderr_buf = Arc::new(Mutex::new((String::new(), 0usize)));
    let out_thread = child
        .stdout
        .take()
        .map(|s| pump(app.clone(), id.clone(), "stdout", s, stdout_buf.clone(), limit));
    let err_thread = child
        .stderr
        .take()
        .map(|s| pump(app.clone(), id.clone(), "stderr", s, stderr_buf.clone(), limit));

    let running = Arc::new(Running { child: Mutex::new(child), cancelled: AtomicBool::new(false) });
    processes.0.lock().map_err(|e| e.to_string())?.insert(id.clone(), running.clone());

    let waiter = running.clone();
    let status = tauri::async_runtime::spawn_blocking(move || loop {
        {
            let mut child = waiter.child.lock().expect("verrou du processus");
            if let Ok(Some(status)) = child.try_wait() {
                return Ok(status.code().unwrap_or(-1));
            }
            if waiter.cancelled.load(Ordering::SeqCst) {
                kill_tree(&mut child);
                let _ = child.wait();
                return Err(130);
            }
            if started.elapsed() >= timeout {
                kill_tree(&mut child);
                let _ = child.wait();
                return Err(124);
            }
        }
        thread::sleep(Duration::from_millis(50));
    })
    .await
    .map_err(|e| e.to_string())?;

    processes.0.lock().map_err(|e| e.to_string())?.remove(&id);
    if let Some(t) = out_thread {
        let _ = t.join();
    }
    if let Some(t) = err_thread {
        let _ = t.join();
    }
    let stdout = stdout_buf.lock().map_err(|e| e.to_string())?.0.clone();
    let mut stderr = stderr_buf.lock().map_err(|e| e.to_string())?.0.clone();
    let exit_code = match status {
        Ok(code) => code,
        Err(124) => {
            stderr.push_str(&format!("\n[Délai dépassé : commande arrêtée après {} s]", timeout.as_secs()));
            124
        }
        Err(code) => {
            stderr.push_str("\n[Commande annulée par l'utilisateur]");
            code
        }
    };
    Ok(CommandResult { exit_code, stdout, stderr, duration_ms: started.elapsed().as_millis() as u64 })
}

#[tauri::command]
pub fn cancel_command(processes: State<'_, Processes>, id: String) -> Result<(), String> {
    if let Some(running) = processes.0.lock().map_err(|e| e.to_string())?.get(&id) {
        running.cancelled.store(true, Ordering::SeqCst);
    }
    Ok(())
}

fn entry(name: &str) -> Result<keyring::Entry, String> {
    if name.is_empty() || name.len() > 64 || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("Nom de secret invalide".into());
    }
    keyring::Entry::new(KEYRING_SERVICE, name).map_err(|e| e.to_string())
}

/// Lit une clé dans le Gestionnaire d'identifiants Windows (jamais journalisée).
#[tauri::command]
pub fn secret_get(name: String) -> Result<Option<String>, String> {
    match entry(&name)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Coffre indisponible : {e}")),
    }
}

#[tauri::command]
pub fn secret_set(name: String, value: String) -> Result<(), String> {
    entry(&name)?.set_password(&value).map_err(|e| format!("Coffre indisponible : {e}"))
}

#[tauri::command]
pub fn secret_delete(name: String) -> Result<(), String> {
    match entry(&name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Coffre indisponible : {e}")),
    }
}
