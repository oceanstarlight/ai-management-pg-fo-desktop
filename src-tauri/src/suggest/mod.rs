//! Prompt suggestions: what the Claude Code mod and the app's own prompt box
//! may suggest (the catalog the mod reads in `<app data>/bridge/state.json`),
//! the log of what was suggested for each prompt sent, and the app's
//! commands behind its suggestion home. The matching itself lives in
//! `claude-mod/branch-notes/hooks/suggest.ts`, shared by the mod and the app.

mod hints;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::tools::ToolId;

type Result<T> = std::result::Result<T, String>;

/// The pref that turns prompt suggestions on: `ai` (Haiku picks, the
/// default), `keyword` (matched locally only) or `off`.
pub const PREF: &str = "promptSuggest";
/// Emitted when the log changes.
pub const LOG_EVENT: &str = "suggest-log-changed";
/// Emitted to the main window with `{ prompt, project }` to start a new
/// automation from a prompt.
pub const DRAFT_EVENT: &str = "automation-draft";

const LOG_FILE: &str = "suggest-log.json";
/// The log keeps this many prompts.
const MAX_LOG: usize = 300;
/// Skill, subagent and command files are read up to this many bytes (the
/// frontmatter is all that's needed).
const MAX_FILE_BYTES: usize = 8 * 1024;
/// Files read for one catalog, at most.
const MAX_FILES: usize = 400;
const AI_TIMEOUT: Duration = Duration::from_secs(60);

// ---------------------------------------------------------------------------
// The catalog

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    mode: String,
    library: Vec<LibraryEntry>,
    extensions: Vec<crate::extensions::SuggestEntry>,
    mcp: Vec<McpEntry>,
    automations: Vec<AutomationEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryEntry {
    kind: crate::library::ItemKind,
    id: String,
    name: String,
    description: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct McpEntry {
    /// The recommended server's id; `None` for one only Claude Code knows.
    id: Option<&'static str>,
    name: String,
    summary: &'static str,
    keywords: &'static [&'static str],
    installed: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct AutomationEntry {
    id: String,
    name: String,
    prompt: String,
    enabled: bool,
}

pub fn mode_of(value: Option<String>) -> String {
    match value.as_deref() {
        Some(mode @ ("ai" | "keyword" | "off")) => mode.to_string(),
        _ => "ai".to_string(),
    }
}

fn mode(app: &AppHandle) -> String {
    let pref = app
        .state::<crate::prefs::Prefs>()
        .store()
        .ok()
        .and_then(|s| s.all().ok())
        .and_then(|mut all| all.remove(PREF));
    mode_of(pref)
}

/// Server names `claude mcp list` gave last (`None` until it ran).
static MCP_INSTALLED: Mutex<Option<Vec<String>>> = Mutex::new(None);

/// Asks Claude Code for its MCP servers in the background (slow: it connects
/// to each), at start and after a change.
pub fn check_mcp_later(app: &AppHandle) {
    let Ok(home) = app.path().home_dir() else {
        return;
    };
    std::thread::spawn(move || {
        if let Ok(names) = crate::mcp::installed_names(&home) {
            *MCP_INSTALLED.lock().unwrap_or_else(|e| e.into_inner()) = Some(names);
            crate::bridge::changed();
        }
    });
}

fn mcp_entries(installed: Option<&[String]>) -> Vec<McpEntry> {
    let has = |name: &str| installed.is_some_and(|list| list.iter().any(|n| n == name));
    let mut out: Vec<McpEntry> = crate::mcp::recommended()
        .into_iter()
        .map(|r| {
            let (summary, keywords) = hints::mcp(r.id);
            McpEntry {
                id: Some(r.id),
                name: r.name.to_string(),
                summary,
                keywords,
                installed: has(r.name),
            }
        })
        .collect();
    for name in installed.unwrap_or_default() {
        if !out.iter().any(|e| e.name == *name) {
            out.push(McpEntry {
                id: None,
                name: name.clone(),
                summary: "",
                keywords: &[],
                installed: true,
            });
        }
    }
    out
}

fn clip(text: &str, max: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max {
        return text.to_string();
    }
    let cut: String = text.chars().take(max - 1).collect();
    format!("{cut}…")
}

/// Everything the suggestions may offer besides what Claude Code has loaded.
pub fn catalog(app: &AppHandle) -> Catalog {
    let mode = mode(app);
    if mode == "off" {
        return Catalog {
            mode,
            ..Catalog::default()
        };
    }
    let library = app
        .state::<crate::library::Library>()
        .items()
        .into_iter()
        .map(|item| LibraryEntry {
            kind: item.kind,
            id: item.id,
            name: item.name,
            description: item.description.unwrap_or_default(),
        })
        .collect();
    let installed = MCP_INSTALLED
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let automations = app
        .state::<crate::automation::Automations>()
        .list()
        .into_iter()
        .map(|a| AutomationEntry {
            prompt: clip(&a.prompt, 200),
            id: a.id,
            name: a.name,
            enabled: a.enabled,
        })
        .collect();
    Catalog {
        mode,
        library,
        extensions: crate::extensions::suggest_entries(),
        mcp: mcp_entries(installed.as_deref()),
        automations,
    }
}

// ---------------------------------------------------------------------------
// What Claude Code has loaded, for the app's own prompt box

/// A skill, subagent or command file; the frontend reads its frontmatter
/// with the mod's own code (`installedCandidate`).
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoadedFile {
    kind: &'static str,
    /// Folder (skill) or file stem.
    name: String,
    /// The plugin it comes with, if any.
    plugin: Option<String>,
    text: String,
}

fn read_head(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut bytes = Vec::new();
    fs::File::open(path)
        .ok()?
        .take(MAX_FILE_BYTES as u64)
        .read_to_end(&mut bytes)
        .ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn sorted_entries(dir: &Path) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = fs::read_dir(dir)
        .map(|rd| rd.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    paths.sort();
    paths
}

/// The skills, subagents and commands under one `.claude`-like folder.
fn scan_dir(root: &Path, plugin: Option<&str>, out: &mut Vec<LoadedFile>) {
    let mut push = |kind: &'static str, name: String, path: &Path| {
        if out.len() >= MAX_FILES {
            return;
        }
        if let Some(text) = read_head(path) {
            out.push(LoadedFile {
                kind,
                name,
                plugin: plugin.map(str::to_string),
                text,
            });
        }
    };
    for dir in sorted_entries(&root.join("skills")) {
        let file = dir.join("SKILL.md");
        if let Some(name) = dir.file_name().and_then(|n| n.to_str())
            && file.is_file()
        {
            push("skill", name.to_string(), &file);
        }
    }
    for (folder, kind) in [("agents", "agent"), ("commands", "command")] {
        for file in sorted_entries(&root.join(folder)) {
            if file.extension().is_some_and(|e| e == "md")
                && let Some(stem) = file.file_stem().and_then(|n| n.to_str())
            {
                push(kind, stem.to_string(), &file);
            }
        }
    }
}

/// `(plugin name, install folder)` of each enabled plugin.
fn plugin_dirs() -> Vec<(String, PathBuf)> {
    let Ok(json) = crate::claude_mod::claude(&["plugin", "list", "--json"]) else {
        return Vec::new();
    };
    parse_plugins(&json)
}

fn parse_plugins(json: &str) -> Vec<(String, PathBuf)> {
    let value: serde_json::Value = serde_json::from_str(json).unwrap_or_default();
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter(|p| p["enabled"].as_bool() != Some(false))
        .filter_map(|p| {
            let name = p["id"].as_str()?.split('@').next()?.to_string();
            let path = PathBuf::from(p["installPath"].as_str()?);
            (!name.is_empty()).then_some((name, path))
        })
        .collect()
}

fn loaded_files(app: &AppHandle, project: Option<&Path>) -> Vec<LoadedFile> {
    let mut out = Vec::new();
    if let Some(project) = project {
        scan_dir(&project.join(".claude"), None, &mut out);
    }
    if let Ok(home) = app.path().home_dir() {
        scan_dir(
            &crate::tools::claude::Env::detect(home).config_dir,
            None,
            &mut out,
        );
    }
    for (name, dir) in plugin_dirs() {
        scan_dir(&dir, Some(&name), &mut out);
    }
    out
}

// ---------------------------------------------------------------------------
// The log

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogItem {
    pub key: String,
    pub name: String,
    pub kind: String,
    pub source: String,
}

/// One prompt sent in Claude Code, what was suggested for it, and what the
/// user picked.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: String,
    pub at: i64,
    pub project: String,
    /// Masked and cut like the prompt log (`activity::redact`).
    pub draft: String,
    pub by: String,
    pub items: Vec<LogItem>,
    pub picked: Vec<String>,
}

static LOG_LOCK: Mutex<()> = Mutex::new(());

fn log_path(data_dir: &Path) -> PathBuf {
    data_dir.join(LOG_FILE)
}

pub fn read_log(data_dir: &Path) -> Vec<LogEntry> {
    fs::read(log_path(data_dir))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_log(data_dir: &Path, log: &[LogEntry]) -> Result<()> {
    let text = serde_json::to_string(log).map_err(|e| e.to_string())?;
    crate::library::ops::write_atomic(&log_path(data_dir), text)
}

/// Adds a prompt to the log (newest last), dropping the oldest past the cap.
pub fn append_log(data_dir: &Path, mut entry: LogEntry) -> Result<()> {
    let _guard = LOG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    entry.draft = crate::activity::redact::prompt_text(&entry.draft);
    entry.items.truncate(10);
    entry
        .picked
        .retain(|k| entry.items.iter().any(|i| i.key == *k));
    if entry.id.is_empty() {
        entry.id = format!("s{}-{}", entry.at, uuid::Uuid::new_v4().simple());
    }
    let mut log = read_log(data_dir);
    log.push(entry);
    if log.len() > MAX_LOG {
        let extra = log.len() - MAX_LOG;
        log.drain(..extra);
    }
    write_log(data_dir, &log)
}

/// How often something was suggested and picked.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Top {
    pub key: String,
    pub name: String,
    pub kind: String,
    pub source: String,
    pub shown: usize,
    pub picked: usize,
}

pub fn top(log: &[LogEntry], limit: usize) -> Vec<Top> {
    let mut out: Vec<Top> = Vec::new();
    for entry in log {
        for item in &entry.items {
            let picked = entry.picked.contains(&item.key);
            match out.iter_mut().find(|t| t.key == item.key) {
                Some(t) => {
                    t.shown += 1;
                    t.picked += usize::from(picked);
                }
                None => out.push(Top {
                    key: item.key.clone(),
                    name: item.name.clone(),
                    kind: item.kind.clone(),
                    source: item.source.clone(),
                    shown: 1,
                    picked: usize::from(picked),
                }),
            }
        }
    }
    out.sort_by(|a, b| b.picked.cmp(&a.picked).then(b.shown.cmp(&a.shown)));
    out.truncate(limit);
    out
}

// ---------------------------------------------------------------------------
// Requests from the mod

fn notify(app: &AppHandle, title: String, result: Result<()>) {
    use tauri_plugin_notification::NotificationExt;
    let body = match result {
        Ok(()) => crate::tr!(
            "Claude Code에서 바로 쓰거나, 안 보이면 다시 시작해 주세요.",
            "Use it in Claude Code now, or restart it if it doesn't show up."
        ),
        Err(e) => crate::tr!("실패했어요: {e}", "It failed: {e}"),
    };
    let _ = app.notification().builder().title(title).body(body).show();
}

fn add_mcp(app: &AppHandle, project: &str, id: &str) -> Result<String> {
    let config_dir = crate::mcp::config_dir(app)?;
    let name = crate::mcp::add_recommended(&config_dir, project, id)?;
    check_mcp_later(app);
    Ok(name)
}

/// Opens the main window on a new automation with this prompt.
fn draft_automation(app: &AppHandle, prompt: String, project: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        crate::shell::show_main(&app);
        // Give a window that was just created time to listen.
        let _ = tauri::async_runtime::spawn_blocking(|| {
            std::thread::sleep(Duration::from_millis(600));
        })
        .await;
        let _ = app.emit(
            DRAFT_EVENT,
            serde_json::json!({ "prompt": prompt, "project": project }),
        );
    });
}

pub fn apply_request(app: &AppHandle, request: crate::bridge::Request) {
    use crate::bridge::Request;
    match request {
        Request::SuggestLog {
            at,
            project,
            draft,
            by,
            items,
            picked,
        } => {
            let Ok(data_dir) = app.path().app_data_dir() else {
                return;
            };
            let entry = LogEntry {
                id: String::new(),
                at,
                project,
                draft,
                by,
                items,
                picked,
            };
            if append_log(&data_dir, entry).is_ok() {
                let _ = app.emit(LOG_EVENT, ());
            }
        }
        Request::AddMcp { id, project } => {
            let app = app.clone();
            std::thread::spawn(move || {
                let result = add_mcp(&app, &project, &id);
                let name = result.as_ref().map_or(id.clone(), |n| n.clone());
                notify(
                    &app,
                    crate::tr!("MCP 서버 추가: {name}", "MCP server added: {name}"),
                    result.map(drop),
                );
            });
        }
        Request::DraftAutomation { prompt, project } => draft_automation(app, prompt, project),
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Commands

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    mode: String,
    /// Newest first.
    log: Vec<LogEntry>,
    top: Vec<Top>,
    prompts: usize,
    picked: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidates {
    catalog: Catalog,
    files: Vec<LoadedFile>,
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn suggest_overview(app: AppHandle) -> Result<Overview> {
    blocking(move || {
        let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let mut log = read_log(&data_dir);
        let top = top(&log, 8);
        let prompts = log.len();
        let picked = log.iter().filter(|e| !e.picked.is_empty()).count();
        log.reverse();
        log.truncate(100);
        Ok(Overview {
            mode: mode(&app),
            log,
            top,
            prompts,
            picked,
        })
    })
    .await
}

#[tauri::command]
pub async fn suggest_candidates(app: AppHandle, project: Option<String>) -> Result<Candidates> {
    blocking(move || {
        let project = project.map(PathBuf::from).filter(|p| p.is_dir());
        Ok(Candidates {
            catalog: catalog(&app),
            files: loaded_files(&app, project.as_deref()),
        })
    })
    .await
}

/// Asks Haiku through the user's own `claude -p` which entries fit; returns
/// its reply text (the frontend reads the numbers with the mod's code).
#[tauri::command]
pub async fn suggest_ai(
    app: AppHandle,
    project: Option<String>,
    system: String,
    prompt: String,
) -> Result<String> {
    blocking(move || {
        let dir = project
            .map(PathBuf::from)
            .filter(|p| p.is_dir())
            .or_else(|| app.path().home_dir().ok())
            .ok_or_else(|| "no folder to run in".to_string())?;
        let args = [
            "-p",
            "--model",
            "haiku",
            "--output-format",
            "json",
            "--no-session-persistence",
            "--strict-mcp-config",
            "--tools",
            "",
            "--system-prompt",
            &system,
        ];
        let (ok, stdout, stderr) = crate::tools::cli::run_with_input(
            ToolId::Claude,
            &dir,
            &args,
            Some(prompt),
            AI_TIMEOUT,
        )?;
        reply_text(ok, &stdout, &stderr)
    })
    .await
}

fn reply_text(ok: bool, stdout: &str, stderr: &str) -> Result<String> {
    let value: serde_json::Value = serde_json::from_str(stdout.trim()).unwrap_or_default();
    let result = value["result"].as_str().unwrap_or_default();
    if ok && value["is_error"].as_bool() != Some(true) {
        return Ok(result.to_string());
    }
    let why = [result, stderr.trim(), stdout.trim()]
        .into_iter()
        .find(|s| !s.is_empty())
        .unwrap_or("claude failed");
    Err(why.lines().next().unwrap_or_default().to_string())
}

#[tauri::command]
pub async fn suggest_add_mcp(app: AppHandle, project: String, id: String) -> Result<String> {
    blocking(move || add_mcp(&app, &project, &id)).await
}

#[tauri::command]
pub async fn suggest_log_clear(app: AppHandle) -> Result<()> {
    blocking(move || {
        let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let _guard = LOG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        write_log(&data_dir, &[])?;
        let _ = app.emit(LOG_EVENT, ());
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(at: i64, items: &[&str], picked: &[&str]) -> LogEntry {
        LogEntry {
            id: String::new(),
            at,
            project: "/p".into(),
            draft: "fix the login bug, token=abcd1234abcd1234abcd1234".into(),
            by: "ai".into(),
            items: items
                .iter()
                .map(|k| LogItem {
                    key: k.to_string(),
                    name: k.to_string(),
                    kind: "skill".into(),
                    source: "installed".into(),
                })
                .collect(),
            picked: picked.iter().map(|k| k.to_string()).collect(),
        }
    }

    #[test]
    fn the_log_masks_secrets_and_keeps_the_newest() {
        let dir = std::env::temp_dir().join(format!("aim-suggest-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        for at in 0..(MAX_LOG as i64 + 5) {
            append_log(&dir, entry(at, &["a", "b"], &["b", "not-shown"])).unwrap();
        }
        let log = read_log(&dir);
        assert_eq!(log.len(), MAX_LOG);
        assert_eq!(log[0].at, 5);
        assert!(!log[0].draft.contains("abcd1234abcd1234"));
        assert_eq!(log[0].picked, ["b"]);
        assert!(!log[0].id.is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn top_ranks_by_picks_then_shows() {
        let log = [
            entry(1, &["a", "b"], &["b"]),
            entry(2, &["a", "b", "c"], &["b"]),
            entry(3, &["a"], &[]),
        ];
        let t = top(&log, 2);
        assert_eq!(t[0].key, "b");
        assert_eq!((t[0].shown, t[0].picked), (2, 2));
        assert_eq!(t[1].key, "a");
        assert_eq!(t[1].shown, 3);
    }

    #[test]
    fn mcp_entries_mark_what_claude_code_has() {
        let installed = vec!["github".to_string(), "my-db".to_string()];
        let entries = mcp_entries(Some(&installed));
        let github = entries.iter().find(|e| e.name == "github").unwrap();
        assert!(github.installed && !github.keywords.is_empty());
        let own = entries.iter().find(|e| e.name == "my-db").unwrap();
        assert_eq!((own.id, own.installed), (None, true));
        assert!(
            mcp_entries(None)
                .iter()
                .all(|e| !e.installed && e.id.is_some())
        );
        for r in crate::mcp::recommended() {
            assert!(!hints::mcp(r.id).0.is_empty(), "no hint for {}", r.id);
        }
    }

    #[test]
    fn modes_default_to_haiku() {
        assert_eq!(mode_of(None), "ai");
        assert_eq!(mode_of(Some("keyword".into())), "keyword");
        assert_eq!(mode_of(Some("x".into())), "ai");
    }

    #[test]
    fn loaded_files_come_from_skills_agents_commands_and_plugins() {
        let dir = std::env::temp_dir().join(format!("aim-scan-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join("skills/review")).unwrap();
        fs::create_dir_all(dir.join("agents")).unwrap();
        fs::create_dir_all(dir.join("commands")).unwrap();
        fs::write(dir.join("skills/review/SKILL.md"), "---\nname: review\n---").unwrap();
        fs::write(dir.join("agents/debugger.md"), "---\nname: debugger\n---").unwrap();
        fs::write(dir.join("commands/ship.md"), "Ship it").unwrap();
        fs::write(dir.join("commands/notes.txt"), "no").unwrap();
        let mut out = Vec::new();
        scan_dir(&dir, Some("tools"), &mut out);
        let got: Vec<(&str, &str)> = out.iter().map(|f| (f.kind, f.name.as_str())).collect();
        assert_eq!(
            got,
            [
                ("skill", "review"),
                ("agent", "debugger"),
                ("command", "ship")
            ]
        );
        assert_eq!(out[0].plugin.as_deref(), Some("tools"));
        fs::remove_dir_all(&dir).unwrap();

        let plugins = parse_plugins(
            r#"[{"id":"eng@m","enabled":true,"installPath":"/x"},{"id":"off@m","enabled":false,"installPath":"/y"}]"#,
        );
        assert_eq!(plugins, [("eng".to_string(), PathBuf::from("/x"))]);
    }

    #[test]
    fn haiku_replies_are_read_from_json() {
        assert_eq!(
            reply_text(true, r#"{"result":"[2, 1]","is_error":false}"#, ""),
            Ok("[2, 1]".to_string())
        );
        assert_eq!(
            reply_text(false, "", "Not logged in\nmore"),
            Err("Not logged in".to_string())
        );
    }
}
