mod activity;
mod anthropic_api;
mod automation;
mod bridge;
mod catalog;
mod claude_auth;
mod claude_detect;
mod claude_mod;
mod decisions;
mod dock;
mod extensions;
mod git;
mod github;
mod i18n;
mod library;
mod mcp;
mod mcp_server;
mod memo;
mod prefs;
mod project_docs;
mod redact;
mod shell;
mod suggest;
mod sync;
mod tools;
mod tray;
mod work;

use tauri::{Manager, WindowEvent};

use dock::{Dock, SIDEBAR_LABEL};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// `<app> mcp`: the MCP server for Claude Code, without any window.
pub fn run_mcp_server(args: &[String]) -> i32 {
    mcp_server::run(args)
}

pub fn run() {
    tauri::Builder::default()
        // Must be registered first: a second launch just shows the running app.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if app.try_state::<shell::Shell>().is_some() {
                shell::reveal(app);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            dock::dock_status,
            dock::dock_cycle_magnet,
            dock::dock_set_pinned,
            dock::dock_set_wide,
            dock::sidebar_hide,
            tools::config_scan,
            tools::tool_detect,
            tools::claude::claude_commands,
            mcp::mcp_list,
            mcp::mcp_save,
            mcp::mcp_remove,
            mcp::mcp_set_enabled,
            mcp::mcp_parse,
            mcp::mcp_recommended,
            project_docs::project_docs_list,
            project_docs::project_doc_read,
            project_docs::project_doc_write,
            project_docs::project_doc_delete,
            library::library_overview,
            library::library_set_dir,
            library::library_apply,
            library::library_remove,
            library::library_update,
            library::library_import,
            library::library_import_preview_github,
            library::library_import_github,
            library::library_import_preview_folder,
            library::library_import_folders,
            library::library_create_skill,
            library::library_generate_skill,
            library::library_forget,
            library::config_set_enabled,
            activity::activity_sessions,
            activity::activity_save,
            catalog::catalog_list,
            catalog::catalog_apply,
            catalog::catalog_refresh,
            anthropic_api::anthropic_key_status,
            anthropic_api::anthropic_key_set,
            claude_auth::claude_auth_expired,
            claude_auth::claude_open_login,
            catalog::catalog_discovered,
            catalog::catalog_candidate_text,
            catalog::catalog_accept,
            catalog::catalog_dismiss,
            catalog::catalog_remove_found,
            memo::memo_context,
            memo::memo_get,
            memo::memo_set_note,
            memo::memo_add_todo,
            memo::memo_update_todo,
            memo::memo_delete_todo,
            memo::memo_move_todo,
            memo::memo_clear_done,
            work::work_overview,
            i18n::set_locale,
            bridge::bridge_github,
            claude_mod::claude_mod_status,
            claude_mod::claude_mod_install,
            claude_mod::claude_mod_install_recommended,
            claude_mod::claude_mod_uninstall,
            claude_mod::mcp_bridge_status,
            claude_mod::mcp_bridge_connect,
            claude_mod::mcp_bridge_disconnect,
            automation::automations_overview,
            automation::automation_save,
            automation::automation_delete,
            automation::automation_set_enabled,
            automation::automation_run,
            extensions::extensions_list,
            extensions::extension_install,
            extensions::extension_uninstall,
            suggest::suggest_overview,
            suggest::suggest_candidates,
            suggest::suggest_ai,
            suggest::suggest_add_mcp,
            suggest::suggest_log_clear,
            suggest::suggest_live,
            suggest::suggest_send,
            suggest::suggest_cloud_claim,
            suggest::suggest_cloud_items,
            sync::relay::relay_status,
            sync::relay::relay_host,
            sync::relay::relay_set_enabled,
            sync::relay::relay_install_hook,
            sync::relay::relay_setup_script,
            decisions::decisions_list,
            decisions::decisions_save,
            decisions::decisions_apply,
            prefs::prefs_all,
            prefs::prefs_set,
            sync::sync_status,
            sync::sync_now,
            sync::sync_set_enabled,
            sync::account::account_status,
            sync::account::account_sign_up,
            sync::account::account_sign_in,
            sync::account::account_reset_password,
            sync::account::account_send_verification,
            sync::account::account_add_password,
            sync::account::account_github,
            sync::account::account_google,
            sync::account::account_google_cancel,
            sync::account::account_unlink,
            sync::account::account_sign_out,
            github::github_status,
            github::github_login_start,
            github::github_login_cancel,
            github::github_logout,
            github::github_repo,
            shell::view_mode,
            shell::view_switch,
        ])
        .setup(|app| {
            let handle = app.handle();
            Dock::manage(handle);
            shell::Shell::manage(handle);
            library::Library::manage(handle)?;
            memo::Memo::manage(handle)?;
            prefs::Prefs::manage(handle)?;
            automation::Automations::manage(handle)?;
            github::GitHub::manage(handle);
            claude_auth::manage(handle);
            sync::Sync::manage(handle);
            sync::relay::start(handle);
            activity::restore(handle);
            activity::start_sweeper(handle);
            bridge::manage(handle);
            extensions::check_later();
            suggest::check_mcp_later(handle);
            automation::start_scheduler(handle);
            catalog::start_auto_check(handle);
            tray::create(handle)?;
            Dock::start(handle)?;
            tray::register_shortcut(handle);
            shell::restore(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the sidebar hides it to the tray; quit from the tray menu. The
            // main window really closes and is created again when reopened.
            if let WindowEvent::CloseRequested { api, .. } = event
                && window.label() == SIDEBAR_LABEL
            {
                api.prevent_close();
                let app = window.app_handle();
                app.state::<Dock>().set_visible(app, false);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // Keeps the home page for the next start (also when quitting to update).
            if let tauri::RunEvent::Exit = event {
                let _ = activity::save(app);
            }
        });
}
