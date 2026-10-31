//! The block catalog: ready-made instructions, rules, skills, subagents and
//! hooks (`catalog/builtin/*.md`, third-party blocks in `catalog/external`
//! and the ones fetched by "최신 받아오기"), plus the skills and subagents in
//! the user's library. The toolbox shows them to copy into a project; the
//! app's MCP server lets Claude Code search them.

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

#[tauri::command]
pub async fn catalog_refresh(app: AppHandle) -> Result<refresh::RefreshResult, String> {
    blocking(app, |app| {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        Ok(refresh::refresh(&cache_dir(&dir)))
    })
    .await
}
