mod commands;
mod policy;
mod workspace;

use commands::Processes;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Processes::default())
        .invoke_handler(tauri::generate_handler![
            commands::fs_load,
            commands::fs_write,
            commands::fs_remove,
            commands::fs_rename,
            commands::fs_mkdir,
            commands::run_command,
            commands::cancel_command,
            commands::secret_get,
            commands::secret_set,
            commands::secret_delete,
        ])
        .run(tauri::generate_context!())
        .expect("échec du démarrage de LAM-Code");
}
