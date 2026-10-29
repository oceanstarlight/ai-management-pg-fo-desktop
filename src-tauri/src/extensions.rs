//! The extension library: popular open-source Claude Code extensions from
//! GitHub (plugins, plugin marketplaces and MCP servers) that the app installs
//! with the user's own `claude` command. Nothing is bundled; each entry was
//! checked for license and content at a pinned commit (docs/research.md §16).

use std::collections::BTreeMap;
use std::sync::Mutex;

use serde::Serialize;

use crate::claude_mod::{add_marketplace, claude, find_claude, install_plugin, installed};
use crate::mcp::{Config, add_args, npx};

type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    /// One plugin from a marketplace.
    Plugin,
    /// A marketplace only: the user picks its plugins in Claude Code (`/plugin`).
    Marketplace,
    /// An MCP server for every project (user scope).
    Mcp,
}

pub struct Extension {
    pub id: &'static str,
    pub name: &'static str,
    pub kind: Kind,
    /// GitHub `owner/repo` of the extension.
    pub repo: &'static str,
    /// The commit its license and content were checked at.
    pub commit: &'static str,
    pub license: &'static str,
    /// `claude plugin marketplace add` source (`owner/repo`) and its name.
    pub marketplace: Option<(&'static str, &'static str)>,
    /// `plugin@marketplace`, for [`Kind::Plugin`].
    pub plugin: Option<&'static str>,
    /// Server name and config, for [`Kind::Mcp`].
    pub mcp: Option<McpServer>,
    /// One line on what it is for, read by the mod's prompt suggestions.
    pub summary: &'static str,
    /// Words (Korean and English) a prompt that needs it would use.
    pub keywords: &'static [&'static str],
}

/// An MCP server's name and how to start it.
pub type McpServer = (&'static str, fn() -> Config);

fn rea() -> Config {
    // REA asks for an exact version in persistent registrations.
    npx(&["-y", "rea-agents@6.5.0", "mcp"], &[])
}

pub const EXTENSIONS: &[Extension] = &[
    Extension {
        id: "rea",
        name: "REA",
        kind: Kind::Mcp,
        repo: "morluto/rea",
        commit: "d69acc3",
        license: "MIT",
        marketplace: None,
        plugin: None,
        mcp: Some(("rea", rea)),
        summary: "A reverse-engineering MCP server for native binaries, Electron and JS apps, .NET, Android APKs and browser behavior.",
        keywords: &[
            "reverse",
            "reversing",
            "decompile",
            "disassemble",
            "binary",
            "apk",
            "android",
            "electron",
            ".net",
            "malware",
            "ghidra",
            "ida",
            "리버스",
            "역공학",
            "리버싱",
            "디컴파일",
            "바이너리",
            "분석",
        ],
    },
    Extension {
        id: "superpowers",
        name: "superpowers",
        kind: Kind::Plugin,
        repo: "obra/superpowers",
        commit: "bb92a77",
        license: "MIT",
        marketplace: Some(("obra/superpowers-marketplace", "superpowers-marketplace")),
        plugin: Some("superpowers@superpowers-marketplace"),
        mcp: None,
        summary: "Skills for a brainstorm, plan, TDD, debug and review way of working.",
        keywords: &[
            "brainstorm",
            "plan",
            "tdd",
            "test",
            "debug",
            "review",
            "workflow",
            "브레인스토밍",
            "계획",
            "테스트",
            "디버그",
            "리뷰",
        ],
    },
    Extension {
        id: "compound-engineering",
        name: "compound-engineering",
        kind: Kind::Plugin,
        repo: "EveryInc/compound-engineering-plugin",
        commit: "7a68002",
        license: "MIT",
        marketplace: Some((
            "EveryInc/compound-engineering-plugin",
            "compound-engineering-plugin",
        )),
        plugin: Some("compound-engineering@compound-engineering-plugin"),
        mcp: None,
        summary: "A plan, work and review loop that keeps what you learn (/ce-plan, /ce-review).",
        keywords: &[
            "plan", "review", "learn", "workflow", "retro", "계획", "리뷰", "회고", "작업",
        ],
    },
    Extension {
        id: "agent-skills",
        name: "agent-skills",
        kind: Kind::Plugin,
        repo: "addyosmani/agent-skills",
        commit: "aeac41d",
        license: "MIT",
        marketplace: Some(("addyosmani/agent-skills", "addy-agent-skills")),
        plugin: Some("agent-skills@addy-agent-skills"),
        mcp: None,
        summary: "Engineering skills for every step: spec, plan, build, verify, review and ship.",
        keywords: &[
            "spec", "plan", "build", "verify", "review", "ship", "release", "스펙", "명세", "계획",
            "검증", "리뷰", "배포",
        ],
    },
    Extension {
        id: "claude-code-workflows",
        name: "wshobson/agents",
        kind: Kind::Marketplace,
        repo: "wshobson/agents",
        commit: "46891e7",
        license: "MIT",
        marketplace: Some(("wshobson/agents", "claude-code-workflows")),
        plugin: None,
        mcp: None,
        summary: "A marketplace of 94 plugins for backend, frontend, security, DevOps and more.",
        keywords: &[
            "backend",
            "frontend",
            "security",
            "devops",
            "kubernetes",
            "database",
            "api",
            "백엔드",
            "프론트엔드",
            "보안",
            "데브옵스",
            "인프라",
            "데이터베이스",
        ],
    },
    Extension {
        id: "voltagent-subagents",
        name: "VoltAgent subagents",
        kind: Kind::Marketplace,
        repo: "VoltAgent/awesome-claude-code-subagents",
        commit: "408d3c9",
        license: "MIT",
        marketplace: Some((
            "VoltAgent/awesome-claude-code-subagents",
            "voltagent-subagents",
        )),
        plugin: None,
        mcp: None,
        summary: "A marketplace of subagents in 10 packs: languages, infrastructure, QA, data and more.",
        keywords: &[
            "subagent",
            "agent",
            "language",
            "infrastructure",
            "qa",
            "data",
            "서브에이전트",
            "에이전트",
            "인프라",
            "데이터",
            "품질",
        ],
    },
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub kind: Kind,
    pub repo: &'static str,
    pub url: String,
    pub commit: &'static str,
    pub license: &'static str,
    /// What gets installed: `plugin@marketplace`, a marketplace or a server name.
    pub target: String,
    pub installed: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub claude_found: bool,
    pub extensions: Vec<ExtensionInfo>,
}

/// Names of the marketplaces Claude Code knows.
fn marketplaces() -> Vec<String> {
    let Ok(json) = claude(&["plugin", "marketplace", "list", "--json"]) else {
        return Vec::new();
    };
    let value: serde_json::Value = serde_json::from_str(&json).unwrap_or_default();
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| m["name"].as_str().map(str::to_string))
        .collect()
}

fn find(id: &str) -> Result<&'static Extension> {
    EXTENSIONS
        .iter()
        .find(|e| e.id == id)
        .ok_or_else(|| "unknown extension".to_string())
}

fn target(e: &Extension) -> String {
    match e.kind {
        Kind::Plugin => e.plugin.unwrap_or_default().to_string(),
        Kind::Marketplace => e.marketplace.map(|m| m.1).unwrap_or_default().to_string(),
        Kind::Mcp => e.mcp.map(|m| m.0).unwrap_or_default().to_string(),
    }
}

pub fn list() -> Listing {
    let claude_found = find_claude().is_some();
    let (plugins, markets) = if claude_found {
        (installed(), marketplaces())
    } else {
        (Vec::new(), Vec::new())
    };
    let extensions = EXTENSIONS
        .iter()
        .map(|e| {
            let target = target(e);
            let installed = claude_found
                && match e.kind {
                    Kind::Plugin => plugins.contains(&target),
                    Kind::Marketplace => markets.contains(&target),
                    Kind::Mcp => claude(&["mcp", "get", &target]).is_ok(),
                };
            remember(e.id, installed);
            ExtensionInfo {
                id: e.id,
                name: e.name,
                kind: e.kind,
                repo: e.repo,
                url: format!("https://github.com/{}", e.repo),
                commit: e.commit,
                license: e.license,
                target,
                installed,
            }
        })
        .collect();
    crate::bridge::changed();
    Listing {
        claude_found,
        extensions,
    }
}

/// Installed state as last checked (checking runs `claude`), for the mod's
/// prompt suggestions in `<app data>/bridge/state.json`.
static INSTALLED: Mutex<BTreeMap<&'static str, bool>> = Mutex::new(BTreeMap::new());

fn remember(id: &'static str, installed: bool) {
    INSTALLED
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(id, installed);
}

/// Checks what is installed in the background (at start and after changes).
pub fn check_later() {
    std::thread::spawn(|| {
        list();
    });
}

/// An extension as the mod's prompt suggestions see it.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SuggestEntry {
    pub id: &'static str,
    pub name: &'static str,
    pub kind: Kind,
    pub repo: &'static str,
    pub summary: &'static str,
    pub keywords: &'static [&'static str],
    /// `None` until checked.
    pub installed: Option<bool>,
}

pub fn suggest_entries() -> Vec<SuggestEntry> {
    let installed = INSTALLED.lock().unwrap_or_else(|e| e.into_inner()).clone();
    EXTENSIONS
        .iter()
        .map(|e| SuggestEntry {
            id: e.id,
            name: e.name,
            kind: e.kind,
            repo: e.repo,
            summary: e.summary,
            keywords: e.keywords,
            installed: installed.get(e.id).copied(),
        })
        .collect()
}

fn need_claude() -> Result<()> {
    if find_claude().is_none() {
        return Err(crate::tr!(
            "Claude Code(claude 명령)를 찾지 못했어요. 설치한 뒤 다시 시도해 주세요",
            "Couldn't find Claude Code (the claude command). Install it and try again"
        ));
    }
    Ok(())
}

pub fn install(id: &str) -> Result<()> {
    need_claude()?;
    let e = find(id)?;
    if let Some((source, name)) = e.marketplace {
        add_marketplace(source, name)?;
    }
    if let Some(plugin) = e.plugin {
        install_plugin(plugin)?;
    }
    if let Some((name, config)) = e.mcp {
        let args = add_args(name, crate::mcp::Scope::User, &config());
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        match claude(&args) {
            Ok(_) => {}
            // Already added (by the user or an earlier install): keep theirs.
            Err(err) if err.to_lowercase().contains("already exists") => {}
            Err(err) => return Err(err),
        }
    }
    Ok(())
}

pub fn uninstall(id: &str) -> Result<()> {
    need_claude()?;
    let e = find(id)?;
    match e.kind {
        Kind::Plugin => claude(&[
            "plugin",
            "uninstall",
            e.plugin.unwrap_or_default(),
            "--scope",
            "user",
        ])
        .map(drop),
        Kind::Marketplace => claude(&[
            "plugin",
            "marketplace",
            "remove",
            e.marketplace.map(|m| m.1).unwrap_or_default(),
        ])
        .map(drop),
        Kind::Mcp => claude(&[
            "mcp",
            "remove",
            e.mcp.map(|m| m.0).unwrap_or_default(),
            "-s",
            "user",
        ])
        .map(drop),
    }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn extensions_list() -> Result<Listing> {
    blocking(|| Ok(list())).await
}

#[tauri::command]
pub async fn extension_install(id: String) -> Result<()> {
    let result = blocking(move || install(&id)).await;
    check_later();
    result
}

#[tauri::command]
pub async fn extension_uninstall(id: String) -> Result<()> {
    let result = blocking(move || uninstall(&id)).await;
    check_later();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_extension_says_what_it_installs() {
        let mut ids = std::collections::HashSet::new();
        for e in EXTENSIONS {
            assert!(ids.insert(e.id), "duplicate id {}", e.id);
            assert!(!target(e).is_empty(), "{}", e.id);
            assert!(e.repo.contains('/') && e.commit.len() >= 7, "{}", e.id);
            assert!(!e.summary.is_empty() && !e.keywords.is_empty(), "{}", e.id);
            match e.kind {
                Kind::Plugin => {
                    let (_, market) = e.marketplace.unwrap();
                    assert!(
                        e.plugin.unwrap().ends_with(&format!("@{market}")),
                        "{}",
                        e.id
                    );
                }
                Kind::Marketplace => assert!(e.marketplace.is_some() && e.plugin.is_none()),
                Kind::Mcp => assert!(e.mcp.is_some() && e.marketplace.is_none()),
            }
        }
    }

    #[test]
    fn rea_is_added_for_every_project_at_a_fixed_version() {
        let (name, config) = find("rea").unwrap().mcp.unwrap();
        let args = add_args(name, crate::mcp::Scope::User, &config());
        assert_eq!(&args[..5], ["mcp", "add", "rea", "-s", "user"]);
        assert!(args.iter().any(|a| a == "rea-agents@6.5.0"));
        assert_eq!(args.last().unwrap(), "mcp");
    }
}
