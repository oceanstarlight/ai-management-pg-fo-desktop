//! Adaptive tools: modules (MCP servers, CLIs and libraries) the user keeps
//! in the app without installing them, and combinations of them, in
//! `<app data>/mcp-hub.json` (the app is its only writer).
//!
//! - A module comes from the built-in catalog ([`catalog`]), from a GitHub
//!   repository read and explained by Haiku ([`analyze`]; nothing runs until
//!   the user approves, then [`install`]), or is written by hand.
//! - Put into a project: an MCP module is added to the project in the scope
//!   the user picks (`crate::mcp`), and taken out again from there.
//! - Through the hub server: Claude Code has one server, `encela-hub`
//!   (`<app> mcp hub`, see [`gateway`]), which starts MCP modules only when
//!   Claude asks for one (or a whole combination), and hands out the usage
//!   guides of CLI and library modules.
//! - A combination is a set of modules, each with a role, and a goal. Its fit
//!   ([`fit`]) says how well the modules work together.

pub mod analyze;
pub mod catalog;
mod client;
pub mod fit;
pub mod gateway;
pub mod install;

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

/// What a module is, which decides how Claude uses it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ModuleKind {
    /// An MCP server: started by the hub, or put into a project.
    #[default]
    Mcp,
    /// A command line tool: Claude runs it itself, from the guide.
    Cli,
    /// A library: Claude uses it in code, from the guide.
    Library,
}

/// Where a module came from.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    /// `owner/repo` on GitHub.
    pub repo: String,
    /// The commit it was read (and installed) at.
    #[serde(default)]
    pub commit: String,
    /// SPDX id, when the license file reads as a known one.
    #[serde(default)]
    pub license: Option<String>,
    /// A license that allows changing, sharing and commercial use.
    #[serde(default)]
    pub license_ok: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// Also its name in Claude Code when put into a project.
    pub name: String,
    /// What it is for: Claude reads it to pick one.
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub kind: ModuleKind,
    /// MCP modules: how to start or reach it. `${VAR}` stands for secrets,
    /// `{project}` for the project folder, `{module}` for where it was built.
    #[serde(default)]
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
    #[serde(default)]
    pub source: Option<Source>,
    /// How to use it (Markdown); the hub gives it to Claude.
    #[serde(default)]
    pub guide: String,
    /// What it can do, takes in and gives back (short words), for fit.
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub inputs: Vec<String>,
    #[serde(default)]
    pub outputs: Vec<String>,
    /// Commands that set it up from a clone; run only when the user says so.
    #[serde(default)]
    pub install: Vec<String>,
    /// Where it was cloned and built, if it was.
    #[serde(default)]
    pub installed_dir: Option<String>,
    /// What the analysis warned about (telemetry, remote scripts, license).
    #[serde(default)]
    pub warnings: Vec<String>,
}

impl Entry {
    /// The config with `{module}` set to where the module was built.
    pub fn runtime_config(&self) -> Config {
        let dir = self.installed_dir.clone().unwrap_or_default();
        let fill = |s: &str| s.replace("{module}", &dir);
        let mut c = self.config.clone();
        c.command = fill(&c.command);
        c.args = c.args.iter().map(|a| fill(a)).collect();
        c.env = c.env.iter().map(|(k, v)| (k.clone(), fill(v))).collect();
        c
    }

    /// Whether the hub can start it (or hand out its guide).
    pub fn runnable(&self) -> bool {
        match self.kind {
            ModuleKind::Mcp => client::supported(&self.config),
            _ => true,
        }
    }
}

fn yes() -> bool {
    true
}

/// A module in a combination, with what it does there.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub module: String,
    #[serde(default)]
    pub role: String,
}

/// How well a combination's modules work together (0-100) and why.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fit {
    pub score: u8,
    #[serde(default)]
    pub reasons: Vec<String>,
    /// `rule` (worked out from the modules) or `ai` (Haiku's judgement).
    #[serde(default)]
    pub by: String,
    #[serde(default)]
    pub at: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Combo {
    pub name: String,
    /// What the combination is for, e.g. "rebuild the app and test it".
    #[serde(default)]
    pub goal: String,
    #[serde(default)]
    pub members: Vec<Member>,
    /// Haiku's fit, kept until the members change.
    #[serde(default)]
    pub ai_fit: Option<Fit>,
}

/// Everything in the file.
#[derive(Clone, Debug, Default)]
pub struct Hub {
    pub modules: Vec<Entry>,
    pub combos: Vec<Combo>,
}

pub fn file(data_dir: &Path) -> PathBuf {
    data_dir.join(FILE)
}

fn read_map(path: &Path) -> Result<Map<String, Value>> {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(e) => return Err(e.to_string()),
    };
    serde_json::from_str(&text).map_err(|e| {
        crate::tr!(
            "{}의 JSON 오류: {e}",
            "JSON error in {}: {e}",
            path.display()
        )
    })
}

/// The modules and combinations, or why the file can't be read.
pub fn load_all(data_dir: &Path) -> Result<Hub> {
    let map = read_map(&file(data_dir))?;
    let get = |key: &str| map.get(key).cloned().unwrap_or(Value::Array(Vec::new()));
    Ok(Hub {
        modules: serde_json::from_value(get("servers")).map_err(|e| e.to_string())?,
        combos: serde_json::from_value(get("combos")).map_err(|e| e.to_string())?,
    })
}

/// The modules alone (missing file = none).
pub fn load(data_dir: &Path) -> Result<Vec<Entry>> {
    load_all(data_dir).map(|h| h.modules)
}

/// Writes everything, keeping other top-level fields of the file.
pub fn store_all(data_dir: &Path, hub: &Hub) -> Result<()> {
    let path = file(data_dir);
    let mut map = read_map(&path).unwrap_or_default();
    map.insert("version".into(), 2.into());
    map.insert(
        "servers".into(),
        serde_json::to_value(&hub.modules).map_err(|e| e.to_string())?,
    );
    map.insert(
        "combos".into(),
        serde_json::to_value(&hub.combos).map_err(|e| e.to_string())?,
    );
    let text = serde_json::to_string_pretty(&map).map_err(|e| e.to_string())? + "\n";
    ops::write_atomic(&path, text)
}

fn clean_list(list: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for item in list.iter().map(|t| t.trim()).filter(|t| !t.is_empty()) {
        if !out.iter().any(|o| o.eq_ignore_ascii_case(item)) {
            out.push(item.to_string());
        }
    }
    out
}

/// Adds `entry`, or replaces the one named `original`. A changed config
/// drops the tools an earlier check found. Combinations follow a rename.
fn upsert(hub: &mut Hub, original: Option<&str>, mut entry: Entry) -> Result<()> {
    entry.name = entry.name.trim().to_string();
    entry.description = entry.description.trim().to_string();
    entry.tags = clean_list(&entry.tags);
    entry.capabilities = clean_list(&entry.capabilities);
    entry.inputs = clean_list(&entry.inputs);
    entry.outputs = clean_list(&entry.outputs);
    mcp::check_name(&entry.name)?;
    if entry.kind == ModuleKind::Mcp {
        mcp::check_config(&entry.config)?;
    }
    let entries = &mut hub.modules;
    let taken = entries
        .iter()
        .any(|e| e.name == entry.name && Some(e.name.as_str()) != original);
    if taken {
        return Err(crate::tr!(
            "같은 이름의 모듈이 있어요: {}",
            "There's already a module named {}",
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
            let old = entries[i].name.clone();
            entries[i] = entry.clone();
            if old != entry.name {
                for c in &mut hub.combos {
                    for m in &mut c.members {
                        if m.module == old {
                            m.module = entry.name.clone();
                        }
                    }
                }
            }
        }
        None => {
            if entry.checked_at.is_none() {
                entry.tools.clear();
            }
            entries.push(entry);
        }
    }
    Ok(())
}

/// Adds `combo`, or replaces the one named `original`. Changed members drop
/// Haiku's fit (it was about other modules).
fn upsert_combo(hub: &mut Hub, original: Option<&str>, mut combo: Combo) -> Result<()> {
    combo.name = combo.name.trim().to_string();
    combo.goal = combo.goal.trim().to_string();
    if combo.name.is_empty() || combo.name.chars().count() > 60 {
        return Err(crate::tr!(
            "조합 이름을 60자 안으로 적어 주세요",
            "Give the combination a name of up to 60 characters"
        ));
    }
    let mut seen: Vec<String> = Vec::new();
    combo.members.retain(|m| {
        let keep = !m.module.trim().is_empty() && !seen.contains(&m.module);
        seen.push(m.module.clone());
        keep
    });
    for m in &mut combo.members {
        m.role = m.role.trim().to_string();
        if !hub.modules.iter().any(|e| e.name == m.module) {
            return Err(crate::tr!(
                "없는 모듈이에요: {}",
                "No module named {}",
                m.module
            ));
        }
    }
    if combo.members.is_empty() {
        return Err(crate::tr!(
            "모듈을 하나 이상 넣어 주세요",
            "Add at least one module"
        ));
    }
    let taken = hub
        .combos
        .iter()
        .any(|c| c.name == combo.name && Some(c.name.as_str()) != original);
    if taken {
        return Err(crate::tr!(
            "같은 이름의 조합이 있어요: {}",
            "There's already a combination named {}",
            combo.name
        ));
    }
    match original.and_then(|o| hub.combos.iter().position(|c| c.name == o)) {
        Some(i) => {
            let old = &hub.combos[i];
            let same: Vec<&str> = old.members.iter().map(|m| m.module.as_str()).collect();
            let now: Vec<&str> = combo.members.iter().map(|m| m.module.as_str()).collect();
            if same != now || old.goal != combo.goal {
                combo.ai_fit = None;
            } else if combo.ai_fit.is_none() {
                combo.ai_fit = old.ai_fit.clone();
            }
            hub.combos[i] = combo;
        }
        None => {
            combo.ai_fit = None;
            hub.combos.push(combo);
        }
    }
    Ok(())
}

pub(crate) fn data_dir(app: &AppHandle) -> Result<PathBuf> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

pub(crate) async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

/// Changes the file under one read-change-write.
fn change<T>(dir: &Path, f: impl FnOnce(&mut Hub) -> Result<T>) -> Result<T> {
    let mut hub = load_all(dir)?;
    let out = f(&mut hub)?;
    store_all(dir, &hub)?;
    Ok(out)
}

// ---------------------------------------------------------------------------
// Commands

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComboView {
    #[serde(flatten)]
    pub combo: Combo,
    /// Worked out from the modules now.
    pub rule_fit: Fit,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub modules: Vec<Entry>,
    pub combos: Vec<ComboView>,
}

#[tauri::command]
pub async fn hub_list(app: AppHandle) -> Result<Listing> {
    let dir = data_dir(&app)?;
    blocking(move || {
        let hub = load_all(&dir)?;
        let combos = hub
            .combos
            .iter()
            .map(|c| ComboView {
                rule_fit: fit::rule_fit(c, &hub.modules),
                combo: c.clone(),
            })
            .collect();
        Ok(Listing {
            modules: hub.modules,
            combos,
        })
    })
    .await
}

/// Adds a module, or changes the one named `original`.
#[tauri::command]
pub async fn hub_save(app: AppHandle, original: Option<String>, entry: Entry) -> Result<()> {
    let dir = data_dir(&app)?;
    blocking(move || change(&dir, |hub| upsert(hub, original.as_deref(), entry))).await
}

/// Removes a module (and takes it out of combinations). A module the app
/// built is deleted from disk too.
#[tauri::command]
pub async fn hub_remove(app: AppHandle, name: String) -> Result<()> {
    let dir = data_dir(&app)?;
    blocking(move || {
        let built = change(&dir, |hub| {
            let built = hub
                .modules
                .iter()
                .find(|e| e.name == name)
                .and_then(|e| e.installed_dir.clone());
            hub.modules.retain(|e| e.name != name);
            for c in &mut hub.combos {
                c.members.retain(|m| m.module != name);
            }
            Ok(built)
        })?;
        if let Some(path) = built.map(PathBuf::from)
            && path.starts_with(install::modules_dir(&dir))
        {
            let _ = fs::remove_dir_all(path);
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn hub_combo_save(app: AppHandle, original: Option<String>, combo: Combo) -> Result<()> {
    let dir = data_dir(&app)?;
    blocking(move || change(&dir, |hub| upsert_combo(hub, original.as_deref(), combo))).await
}

#[tauri::command]
pub async fn hub_combo_remove(app: AppHandle, name: String) -> Result<()> {
    let dir = data_dir(&app)?;
    blocking(move || {
        change(&dir, |hub| {
            hub.combos.retain(|c| c.name != name);
            Ok(())
        })
    })
    .await
}

/// Asks Haiku how well a combination works together, and keeps the answer.
#[tauri::command]
pub async fn hub_combo_fit(app: AppHandle, name: String) -> Result<Fit> {
    let dir = data_dir(&app)?;
    let run_dir = crate::suggest::run_dir(&app, None)?;
    blocking(move || {
        let hub = load_all(&dir)?;
        let combo = hub
            .combos
            .iter()
            .find(|c| c.name == name)
            .ok_or_else(|| crate::tr!("없는 조합이에요", "No such combination"))?;
        let fit = fit::ai_fit(&run_dir, combo, &hub.modules)?;
        change(&dir, |hub| {
            if let Some(c) = hub.combos.iter_mut().find(|c| c.name == name) {
                c.ai_fit = Some(fit.clone());
            }
            Ok(())
        })?;
        Ok(fit)
    })
    .await
}

/// Starts an MCP module (in `project`, or the home folder), lists its tools
/// and remembers them.
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
            .ok_or_else(|| crate::tr!("없는 모듈이에요", "No such module"))?;
        if entry.kind != ModuleKind::Mcp {
            return Err(crate::tr!(
                "MCP 모듈만 실행해서 확인할 수 있어요",
                "Only MCP modules can be run to check"
            ));
        }
        let cwd = project
            .map(PathBuf::from)
            .filter(|p| p.is_dir())
            .unwrap_or(home);
        let client = client::Client::start(&entry.runtime_config(), &cwd, None)?;
        let tools: Vec<ToolInfo> = client
            .tools()
            .iter()
            .map(|t| ToolInfo {
                name: t["name"].as_str().unwrap_or_default().to_string(),
                description: first_line(t["description"].as_str().unwrap_or_default()),
            })
            .collect();
        client.close();
        // Read again: the file may have changed while the server started.
        change(&dir, |hub| {
            if let Some(e) = hub.modules.iter_mut().find(|e| e.name == name) {
                e.tools = tools.clone();
                e.checked_at = Some(now_ms());
            }
            Ok(())
        })?;
        Ok(tools)
    })
    .await
}

/// Puts an MCP module into `project` in `scope` under `name` (default: its
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
            .ok_or_else(|| crate::tr!("없는 모듈이에요", "No such module"))?;
        if entry.kind != ModuleKind::Mcp {
            return Err(crate::tr!(
                "MCP 모듈만 프로젝트에 넣을 수 있어요",
                "Only MCP modules can be put into a project"
            ));
        }
        let project_dir = PathBuf::from(&project);
        if !project_dir.is_dir() {
            return Err(crate::tr!(
                "폴더를 찾을 수 없어요: {project}",
                "Folder not found: {project}"
            ));
        }
        let mut config = entry.runtime_config();
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

#[tauri::command]
pub fn module_catalog() -> Vec<catalog::CatalogModule> {
    catalog::modules()
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
            tags: vec![" security ".into(), "".into(), "Security".into()],
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
            ..Entry::default()
        }
    }

    fn combo(name: &str, members: &[&str]) -> Combo {
        Combo {
            name: name.into(),
            goal: "goal".into(),
            members: members
                .iter()
                .map(|m| Member {
                    module: m.to_string(),
                    role: String::new(),
                })
                .collect(),
            ai_fit: None,
        }
    }

    #[test]
    fn modules_are_added_renamed_and_checked() {
        let mut hub = Hub::default();
        upsert(&mut hub, None, entry("scan", "npx")).unwrap();
        let list = &hub.modules;
        assert_eq!(list[0].description, "scans");
        assert_eq!(list[0].tags, ["security"]);
        // A new entry's tools are unknown until checked.
        assert!(list[0].tools.is_empty());
        assert!(upsert(&mut hub, None, entry("scan", "uvx")).is_err());
        assert!(upsert(&mut hub, None, entry("bad name", "npx")).is_err());

        upsert_combo(&mut hub, None, combo("c", &["scan"])).unwrap();
        hub.modules[0].tools = vec![ToolInfo::default()];
        upsert(&mut hub, Some("scan"), entry("scan2", "npx")).unwrap();
        assert_eq!(hub.modules.len(), 1);
        assert_eq!(hub.modules[0].name, "scan2");
        assert_eq!(hub.modules[0].tools.len(), 1, "same config keeps the tools");
        assert_eq!(hub.combos[0].members[0].module, "scan2", "combos follow");
        upsert(&mut hub, Some("scan2"), entry("scan2", "uvx")).unwrap();
        assert!(
            hub.modules[0].tools.is_empty(),
            "a new config needs a check"
        );
    }

    #[test]
    fn cli_modules_need_no_server_config() {
        let mut hub = Hub::default();
        let cli = Entry {
            name: "ghidra-cli".into(),
            kind: ModuleKind::Cli,
            guide: "Run `x`".into(),
            ..Entry::default()
        };
        upsert(&mut hub, None, cli).unwrap();
        assert!(hub.modules[0].runnable());
    }

    #[test]
    fn combos_need_known_modules_and_drop_stale_fits() {
        let mut hub = Hub::default();
        upsert(&mut hub, None, entry("a", "npx")).unwrap();
        upsert(&mut hub, None, entry("b", "npx")).unwrap();
        assert!(upsert_combo(&mut hub, None, combo("x", &["nope"])).is_err());
        assert!(upsert_combo(&mut hub, None, combo("x", &[])).is_err());
        upsert_combo(&mut hub, None, combo("x", &["a", "a", "b"])).unwrap();
        assert_eq!(hub.combos[0].members.len(), 2);
        hub.combos[0].ai_fit = Some(Fit::default());
        // Same members, new role: the fit stays.
        let mut same = combo("x", &["a", "b"]);
        same.members[0].role = "reads".into();
        upsert_combo(&mut hub, Some("x"), same).unwrap();
        assert!(hub.combos[0].ai_fit.is_some());
        upsert_combo(&mut hub, Some("x"), combo("x", &["a"])).unwrap();
        assert!(hub.combos[0].ai_fit.is_none());
    }

    #[test]
    fn module_placeholders_point_at_the_build() {
        let e = Entry {
            installed_dir: Some("/data/modules/rea".into()),
            config: Config {
                transport: "stdio".into(),
                command: "{module}/bin/rea".into(),
                args: vec!["--root".into(), "{module}".into(), "{project}".into()],
                ..Config::default()
            },
            ..Entry::default()
        };
        let c = e.runtime_config();
        assert_eq!(c.command, "/data/modules/rea/bin/rea");
        assert_eq!(c.args, ["--root", "/data/modules/rea", "{project}"]);
    }

    #[test]
    fn the_file_round_trips_and_keeps_unknown_fields() {
        let dir = std::env::temp_dir().join(format!("encela-hub-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        assert!(load(&dir).unwrap().is_empty());
        // A version 1 file: servers only.
        fs::write(
            file(&dir),
            r#"{"future":1,"version":1,"servers":[{"name":"old","config":{"transport":"stdio","command":"npx"}}]}"#,
        )
        .unwrap();
        let mut hub = load_all(&dir).unwrap();
        assert_eq!(hub.modules[0].kind, ModuleKind::Mcp);
        assert!(hub.modules[0].in_hub);
        upsert(&mut hub, None, entry("a", "npx")).unwrap();
        upsert_combo(&mut hub, None, combo("c", &["old", "a"])).unwrap();
        store_all(&dir, &hub).unwrap();
        let back = load_all(&dir).unwrap();
        assert_eq!(back.modules.len(), 2);
        assert_eq!(back.combos[0].members.len(), 2);
        let raw: Value = serde_json::from_str(&fs::read_to_string(file(&dir)).unwrap()).unwrap();
        assert_eq!(raw["future"], 1);
        fs::remove_dir_all(dir).unwrap();
    }
}
