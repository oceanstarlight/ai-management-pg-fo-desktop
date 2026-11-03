//! The MCP hub: MCP servers the user keeps in the app without installing
//! them, in `<app data>/mcp-hub.json` (the app is its only writer).
//!
//! - Put into a project: a kept server is added to the project in the scope
//!   the user picks (`crate::mcp`), and taken out again from there.
//! - Through the hub server: Claude Code has one server, `encela-hub`
//!   (`<app> mcp hub`, see [`gateway`]), which starts kept servers only when
//!   Claude asks for one, and passes their tools through.

mod client;
pub mod gateway;

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};

use crate::library::ops;
use crate::mcp::{self, Config, Scope};

type Result<T> = std::result::Result<T, String>;

/// The name the hub server is registered under in Claude Code.
pub const HUB_NAME: &str = "encela-hub";
const FILE: &str = "mcp-hub.json";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub name: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// Also its name in Claude Code when put into a project.
    pub name: String,
    /// What it is for, in the user's words: Claude reads it to pick one.
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    /// `${VAR}` stands for secrets; `{project}` for the project folder.
    pub config: Config,
    /// Offered through the hub server.
    #[serde(default = "yes")]
    pub in_hub: bool,
    /// Tools the last check found.
    #[serde(default)]
    pub tools: Vec<ToolInfo>,
    /// When the last check ran (ms since the epoch).
    #[serde(default)]
    pub checked_at: Option<i64>,
}

fn yes() -> bool {
    true
}

pub fn file(data_dir: &Path) -> PathBuf {
    data_dir.join(FILE)
}

/// The kept servers, or why the file can't be read (missing = none).
pub fn load(data_dir: &Path) -> Result<Vec<Entry>> {
    let path = file(data_dir);
    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let value: Value = serde_json::from_str(&text).map_err(|e| {
        crate::tr!(
            "{}의 JSON 오류: {e}",
            "JSON error in {}: {e}",
            path.display()
        )
    })?;
    serde_json::from_value(value["servers"].clone()).map_err(|e| e.to_string())
}

/// Writes the list, keeping other top-level fields of the file.
fn store(data_dir: &Path, entries: &[Entry]) -> Result<()> {
    let path = file(data_dir);
    let mut map: Map<String, Value> = fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    map.insert("version".into(), 1.into());
    map.insert(
        "servers".into(),
        serde_json::to_value(entries).map_err(|e| e.to_string())?,
    );
    let text = serde_json::to_string_pretty(&map).map_err(|e| e.to_string())? + "\n";
    ops::write_atomic(&path, text)
}

/// Adds `entry`, or replaces the one named `original`. A changed config
/// drops the tools an earlier check found.
fn upsert(entries: &mut Vec<Entry>, original: Option<&str>, mut entry: Entry) -> Result<()> {
    entry.name = entry.name.trim().to_string();
    entry.description = entry.description.trim().to_string();
    entry.tags = entry
        .tags
        .iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    mcp::check_name(&entry.name)?;
    mcp::check_config(&entry.config)?;
    let taken = entries
        .iter()
        .any(|e| e.name == entry.name && Some(e.name.as_str()) != original);
    if taken {
        return Err(crate::tr!(
            "보관함에 같은 이름이 있어요: {}",
            "The hub already has a server named {}",
            entry.name
        ));
    }
    match original.and_then(|o| entries.iter().position(|e| e.name == o)) {
        Some(i) => {
            if entries[i].config == entry.config {
                entry.tools = entries[i].tools.clone();
                entry.checked_at = entries[i].checked_at;
            } else {
                entry.tools.clear();
                entry.checked_at = None;
            }
            entries[i] = entry;
        }
        None => {
            entry.tools.clear();
            entry.checked_at = None;
            entries.push(entry);
        }
    }
    Ok(())
}

fn data_dir(app: &AppHandle) -> Result<PathBuf> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Commands

#[tauri::command]
pub async fn hub_list(app: AppHandle) -> Result<Vec<Entry>> {
    let dir = data_dir(&app)?;
    blocking(move || load(&dir)).await
}

/// Adds a server to the hub, or changes the one named `original`.
#[tauri::command]
pub async fn hub_save(app: AppHandle, original: Option<String>, entry: Entry) -> Result<()> {
    let dir = data_dir(&app)?;
    blocking(move || {
        let mut entries = load(&dir)?;
        upsert(&mut entries, original.as_deref(), entry)?;
        store(&dir, &entries)
    })
    .await
}

#[tauri::command]
pub async fn hub_remove(app: AppHandle, name: String) -> Result<()> {
    let dir = data_dir(&app)?;
    blocking(move || {
        let mut entries = load(&dir)?;
        entries.retain(|e| e.name != name);
        store(&dir, &entries)
    })
    .await
}

/// Starts the server (in `project`, or the home folder), lists its tools and
/// remembers them.
#[tauri::command]
pub async fn hub_check(
    app: AppHandle,
    name: String,
    project: Option<String>,
) -> Result<Vec<ToolInfo>> {
    let dir = data_dir(&app)?;
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    blocking(move || {
        let entries = load(&dir)?;
        let entry = entries
            .iter()
            .find(|e| e.name == name)
            .ok_or_else(|| crate::tr!("보관함에 없는 서버예요", "Not in the hub"))?;
        let cwd = project
            .map(PathBuf::from)
            .filter(|p| p.is_dir())
            .unwrap_or(home);
        let client = client::Client::start(&entry.config, &cwd, None)?;
        let tools: Vec<ToolInfo> = client
            .tools()
            .iter()
            .map(|t| ToolInfo {
                name: t["name"].as_str().unwrap_or_default().to_string(),
                description: first_line(t["description"].as_str().unwrap_or_default()),
            })
            .collect();
        client.close();
        // Read again: the list may have changed while the server started.
        let mut entries = load(&dir)?;
        if let Some(e) = entries.iter_mut().find(|e| e.name == name) {
            e.tools = tools.clone();
            e.checked_at = Some(now_ms());
            store(&dir, &entries)?;
        }
        Ok(tools)
    })
    .await
}

/// Puts a kept server into `project` in `scope` under `name` (default: its
/// own name).
#[tauri::command]
pub async fn hub_apply(
    app: AppHandle,
    project: String,
    name: String,
    scope: Scope,
    as_name: Option<String>,
) -> Result<()> {
    let dir = data_dir(&app)?;
    let config_dir = mcp::config_dir(&app)?;
    blocking(move || {
        let entries = load(&dir)?;
        let entry = entries
            .iter()
            .find(|e| e.name == name)
            .ok_or_else(|| crate::tr!("보관함에 없는 서버예요", "Not in the hub"))?;
        let project_dir = PathBuf::from(&project);
        if !project_dir.is_dir() {
            return Err(crate::tr!(
                "폴더를 찾을 수 없어요: {project}",
                "Folder not found: {project}"
            ));
        }
        let mut config = entry.config.clone();
        config.args = config
            .args
            .iter()
            .map(|a| a.replace("{project}", &project))
            .collect();
        let target = as_name.as_deref().map(str::trim).unwrap_or(&entry.name);
        mcp::save(&project_dir, &config_dir, None, scope, target, &config)
    })
    .await?;
    crate::suggest::check_mcp_later(&app);
    Ok(())
}

fn first_line(text: &str) -> String {
    let line = text
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    let chars: Vec<char> = line.chars().collect();
    if chars.len() > 160 {
        chars[..157].iter().collect::<String>() + "…"
    } else {
        line.to_string()
    }
}

// Registering the hub server with Claude Code (user scope), like `encela`.

#[tauri::command]
pub async fn hub_server_status() -> crate::claude_mod::McpStatus {
    tauri::async_runtime::spawn_blocking(|| crate::claude_mod::server_status(HUB_NAME))
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn hub_server_connect(app: AppHandle) -> Result<()> {
    let dir = data_dir(&app)?;
    blocking(move || crate::claude_mod::server_connect(HUB_NAME, &["mcp", "hub"], &dir)).await
}

#[tauri::command]
pub async fn hub_server_disconnect() -> Result<()> {
    blocking(|| crate::claude_mod::server_disconnect(HUB_NAME)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, command: &str) -> Entry {
        Entry {
            name: name.into(),
            description: " scans ".into(),
            tags: vec![" security ".into(), "".into()],
            config: Config {
                transport: "stdio".into(),
                command: command.into(),
                ..Config::default()
            },
            in_hub: true,
            tools: vec![ToolInfo {
                name: "x".into(),
                description: String::new(),
            }],
            checked_at: Some(1),
        }
    }

    #[test]
    fn entries_are_added_renamed_and_checked() {
        let mut list = Vec::new();
        upsert(&mut list, None, entry("scan", "npx")).unwrap();
        assert_eq!(list[0].description, "scans");
        assert_eq!(list[0].tags, ["security"]);
        // A new entry's tools are unknown until checked.
        assert!(list[0].tools.is_empty());
        assert!(upsert(&mut list, None, entry("scan", "uvx")).is_err());
        assert!(upsert(&mut list, None, entry("bad name", "npx")).is_err());

        list[0].tools = vec![ToolInfo::default()];
        upsert(&mut list, Some("scan"), entry("scan2", "npx")).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "scan2");
        assert_eq!(
            list[0].tools.len(),
            1,
            "same config keeps the checked tools"
        );
        upsert(&mut list, Some("scan2"), entry("scan2", "uvx")).unwrap();
        assert!(list[0].tools.is_empty(), "a new config needs a new check");
    }

    #[test]
    fn the_file_round_trips_and_keeps_unknown_fields() {
        let dir = std::env::temp_dir().join(format!("encela-hub-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        assert!(load(&dir).unwrap().is_empty());
        fs::write(file(&dir), r#"{"future":1,"servers":[]}"#).unwrap();
        let mut list = Vec::new();
        upsert(&mut list, None, entry("a", "npx")).unwrap();
        store(&dir, &list).unwrap();
        assert_eq!(load(&dir).unwrap()[0].name, "a");
        let raw: Value = serde_json::from_str(&fs::read_to_string(file(&dir)).unwrap()).unwrap();
        assert_eq!(raw["future"], 1);
        fs::remove_dir_all(dir).unwrap();
    }
}
