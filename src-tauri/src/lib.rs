mod commands;
mod policy;
mod workspace;

use commands::{Processes, Workspaces};
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Processes::default())
        .setup(|app| {
            let workspaces = Workspaces::load(app.handle());
            app.manage(workspaces);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pick_workspace,
            commands::fs_load,
            commands::fs_write,
            commands::fs_remove,
            commands::fs_rename,
            commands::fs_mkdir,
            commands::run_command,
            commands::detach_command,
            commands::cancel_command,
            commands::secret_get,
            commands::secret_set,
            commands::secret_delete,
        ])
        .build(tauri::generate_context!())
        .expect("échec du démarrage de LAM-Code")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Processes>().kill_all();
            }
        });
}
