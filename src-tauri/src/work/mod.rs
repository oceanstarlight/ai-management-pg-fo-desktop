//! The open project's git status, read only: the branch, changed files,
//! unpushed commits and worktrees. Git itself is left to the terminal and
//! Claude Code.

mod read;

use std::path::{Path, PathBuf};

use read::Overview;

/// The Codex app's worktree root, to label its worktrees; `None` when the
/// home folder is unknown.
fn codex_worktree_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    let home = app.path().home_dir().ok()?;
    let env = crate::tools::codex::Env::detect(home);
    Some(read::codex_worktree_root_in(&env.codex_home, &env.home))
}

/// `None` when the project is not a git repository.
#[tauri::command]
pub async fn work_overview(
    app: tauri::AppHandle,
    project: String,
    count_worktrees: bool,
) -> Result<Option<Overview>, String> {
    let codex_root = codex_worktree_root(&app);
    tauri::async_runtime::spawn_blocking(move || match read::root(Path::new(&project))? {
        Some(root) => read::overview(&root, count_worktrees, codex_root.as_deref()).map(Some),
        None => Ok(None),
    })
    .await
    .map_err(|e| e.to_string())?
}
