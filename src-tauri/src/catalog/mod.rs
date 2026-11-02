//! The block catalog: ready-made instructions, rules, skills, subagents and
//! hooks (`catalog/builtin/*.md`, third-party blocks in `catalog/external`
//! and the ones fetched by "최신 받아오기"), plus the skills and subagents in
//! the user's library. The toolbox shows them to copy into a project; the
//! app's MCP server lets Claude Code search them.

pub mod apply;
pub mod blocks;
pub mod discover;
pub mod fetch;
pub mod refresh;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

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

fn cache_for(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| cache_dir(&d))
        .map_err(|e| e.to_string())
}

/// Emitted (no payload) when the catalog or its finds changed by themselves.
pub const CHANGED_EVENT: &str = "catalog-changed";
/// Preference: `"off"` stops the daily check.
pub const AUTO_PREF: &str = "catalogAutoCheck";
const AUTO_EVERY: Duration = Duration::from_secs(24 * 60 * 60);

/// One check at a time, whether started by the user or the timer.
static CHECKING: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub refresh: refresh::RefreshResult,
    pub discover: discover::DiscoverResult,
}

/// "최신 받아오기": brings bundled and found blocks up to date and looks for
/// new ones next to them.
fn check(app: &AppHandle) -> Result<CheckResult, String> {
    let _one = CHECKING.lock().unwrap_or_else(|e| e.into_inner());
    let cache = cache_for(app)?;
    let token = crate::github::current_token(app);
    let result = CheckResult {
        refresh: refresh::refresh(&cache),
        discover: discover::discover(&cache, token.as_deref()),
    };
    if !result.refresh.updated.is_empty() {
        crate::sync::changed(app);
    }
    Ok(result)
}

#[tauri::command]
pub async fn catalog_refresh(app: AppHandle) -> Result<CheckResult, String> {
    blocking(app, check).await
}

/// Checks once a day in the background while the app runs, unless turned off.
pub fn start_auto_check(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        // Not in the way of the app's start.
        std::thread::sleep(Duration::from_secs(120));
        loop {
            let on = crate::prefs::get(&app, AUTO_PREF).as_deref() != Some("off");
            let due = cache_for(&app).is_ok_and(|cache| {
                let last = discover::load(&cache).checked_at;
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or_default();
                now - last >= AUTO_EVERY.as_millis() as i64
            });
            if on && due && check(&app).is_ok() {
                let _ = app.emit(CHANGED_EVENT, ());
            }
            std::thread::sleep(Duration::from_secs(60 * 60));
        }
    });
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovered {
    pub checked_at: i64,
    pub candidates: Vec<discover::Candidate>,
    pub failed: Vec<(String, String)>,
    pub auto: bool,
}

#[tauri::command]
pub async fn catalog_discovered(app: AppHandle) -> Result<Discovered, String> {
    blocking(app, |app| {
        let state = discover::load(&cache_for(app)?);
        Ok(Discovered {
            checked_at: state.checked_at,
            candidates: state.candidates,
            failed: state.failed,
            auto: crate::prefs::get(app, AUTO_PREF).as_deref() != Some("off"),
        })
    })
    .await
}

/// A waiting find's upstream text, to read before taking it in.
#[tauri::command]
pub async fn catalog_candidate_text(app: AppHandle, id: String) -> Result<String, String> {
    blocking(app, move |app| discover::text(&cache_for(app)?, &id)).await
}

/// Takes a find into the catalog (and the account's synced copy).
#[tauri::command]
pub async fn catalog_accept(app: AppHandle, id: String) -> Result<String, String> {
    blocking(app, move |app| {
        let name = discover::accept(&cache_for(app)?, &id)?;
        crate::sync::changed(app);
        Ok(name)
    })
    .await
}

#[tauri::command]
pub async fn catalog_dismiss(app: AppHandle, id: String) -> Result<(), String> {
    blocking(app, move |app| discover::dismiss(&cache_for(app)?, &id)).await
}

/// Takes a found block back out of the catalog. `id` is `<source>__<stem>`.
#[tauri::command]
pub async fn catalog_remove_found(app: AppHandle, id: String) -> Result<(), String> {
    blocking(app, move |app| {
        discover::remove_found(&cache_for(app)?, &id)?;
        crate::sync::changed(app);
        Ok(())
    })
    .await
}
