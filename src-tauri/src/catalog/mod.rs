//! The block catalog: ready-made instructions, rules, skills, subagents and
//! hooks (`catalog/builtin/*.md`, third-party blocks in `catalog/external`
//! and the ones fetched by "최신 받아오기"), plus the skills and subagents in
//! the user's library. The toolbox shows them to copy into a project; the
//! app's MCP server lets Claude Code search them.

pub mod apply;
pub mod blocks;
pub mod refresh;

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::library::Library;
pub use blocks::{Block, BlockKind};

/// Third-party blocks fetched by "최신 받아오기".
pub fn cache_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("catalog-cache")
}

fn all_for(app: &AppHandle) -> Vec<Block> {
    let cache = app.path().app_data_dir().ok().map(|d| cache_dir(&d));
    blocks::all(&app.state::<Library>().items(), cache.as_deref())
}

async fn blocking<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || f(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn catalog_list(app: AppHandle) -> Result<Vec<Block>, String> {
    blocking(app, |app| Ok(all_for(app))).await
}

/// Every block prompt suggestions may offer: the bundled and fetched ones
/// (library items are suggested as such), without blocks that need filling in.
pub fn suggestible(app: &AppHandle) -> Vec<Block> {
    let cache = app.path().app_data_dir().ok().map(|d| cache_dir(&d));
    blocks::all(&[], cache.as_deref())
        .into_iter()
        .filter(apply::suggestible)
        .collect()
}

/// Writes a suggested block into the project, for the user only. A hook runs
/// commands by itself, so it is written only once the user `confirmed` it.
pub fn apply_to(
    app: &AppHandle,
    project: &Path,
    id: &str,
    confirmed: bool,
) -> Result<apply::Applied, String> {
    let block = suggestible(app)
        .into_iter()
        .find(|b| b.id == id)
        .ok_or_else(|| {
            crate::tr!(
                "카탈로그에 없는 블록이에요: {id}",
                "No such catalog block: {id}"
            )
        })?;
    if block.kind == BlockKind::Hook && !confirmed {
        return Err(crate::tr!(
            "hook은 확인한 뒤에만 추가해요",
            "A hook is added only after you confirm it"
        ));
    }
    apply::apply(project, &block)
}

/// The command a hook block runs, to show before it is added.
pub fn hook_command(app: &AppHandle, id: &str) -> Option<(String, String)> {
    suggestible(app)
        .into_iter()
        .find(|b| b.id == id && b.kind == BlockKind::Hook)
        .map(|b| (b.display_title().to_string(), b.body.trim().to_string()))
}

#[tauri::command]
pub async fn catalog_apply(
    app: AppHandle,
    project: String,
    id: String,
    confirmed: bool,
) -> Result<apply::Applied, String> {
    blocking(app, move |app| {
        apply_to(app, Path::new(&project), &id, confirmed)
    })
    .await
}

#[tauri::command]
pub async fn catalog_refresh(app: AppHandle) -> Result<refresh::RefreshResult, String> {
    blocking(app, |app| {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        Ok(refresh::refresh(&cache_dir(&dir)))
    })
    .await
}
