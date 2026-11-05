//! Modules the app offers ready-made, and the starter set a new user begins
//! with. The data is `catalog/modules.json`, shared with the encela npm
//! package (`packages/encela`): the recommended MCP servers
//! (`crate::mcp::recommended`, docs/research.md §11) and the MCP servers and
//! CLIs checked for license and content in docs/research.md §21. The app
//! only keeps how to run them; the user's tools fetch the code itself.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use super::{Combo, Entry, Hub, Member, ModuleKind, Source};
use crate::mcp::Config;

const DATA: &str = include_str!("../../catalog/modules.json");

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogModule {
    /// Stable id; recommended MCP servers keep theirs (`mcp.rec.<id>` strings).
    pub id: String,
    /// What it needs first: `node`, `uv`, `token`, `signin`, `app`.
    pub needs: String,
    /// The module as it is added.
    pub module: Entry,
}

/// A string in both UI languages.
#[derive(Clone, Debug, Default, Deserialize)]
struct Text {
    ko: String,
    en: String,
}

impl Text {
    fn get(&self) -> String {
        if crate::i18n::english() {
            self.en.clone()
        } else {
            self.ko.clone()
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
struct Texts {
    ko: Vec<String>,
    en: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Item {
    id: String,
    name: String,
    kind: ModuleKind,
    needs: String,
    description: Text,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    capabilities: Vec<String>,
    #[serde(default)]
    inputs: Vec<String>,
    #[serde(default)]
    outputs: Vec<String>,
    config: Option<Config>,
    source: Option<Source>,
    #[serde(default)]
    install: Vec<String>,
    #[serde(default)]
    guide: Text,
    #[serde(default)]
    warnings: Texts,
}

#[derive(Clone, Debug, Deserialize)]
struct StarterMember {
    module: String,
    role: Text,
}

#[derive(Clone, Debug, Deserialize)]
struct StarterCombo {
    name: Text,
    goal: Text,
    members: Vec<StarterMember>,
}

#[derive(Clone, Debug, Deserialize)]
struct Starter {
    modules: Vec<String>,
    combos: Vec<StarterCombo>,
}

#[derive(Clone, Debug, Deserialize)]
struct Data {
    modules: Vec<Item>,
    starter: Starter,
}

fn data() -> &'static Data {
    static DATA_ONCE: OnceLock<Data> = OnceLock::new();
    DATA_ONCE.get_or_init(|| serde_json::from_str(DATA).expect("catalog/modules.json"))
}

/// The file's configs are for macOS and Linux; Windows runs npx through
/// `cmd /c` (as `crate::mcp::npx` does).
fn for_this_os(mut config: Config) -> Config {
    if cfg!(windows) && config.command == "npx" {
        config.command = "cmd".into();
        config.args = ["/c".to_string(), "npx".to_string()]
            .into_iter()
            .chain(config.args)
            .collect();
    }
    config
}

fn entry(item: &Item) -> Entry {
    let warnings = if crate::i18n::english() {
        item.warnings.en.clone()
    } else {
        item.warnings.ko.clone()
    };
    Entry {
        name: item.name.clone(),
        description: item.description.get(),
        tags: item.tags.clone(),
        kind: item.kind,
        config: item.config.clone().map(for_this_os).unwrap_or_default(),
        in_hub: true,
        source: item.source.clone(),
        guide: item.guide.get(),
        capabilities: item.capabilities.clone(),
        inputs: item.inputs.clone(),
        outputs: item.outputs.clone(),
        install: item.install.clone(),
        warnings,
        ..Entry::default()
    }
}

/// Every ready-made module, in the UI language.
pub fn modules() -> Vec<CatalogModule> {
    data()
        .modules
        .iter()
        .map(|item| CatalogModule {
            id: item.id.clone(),
            needs: item.needs.clone(),
            module: entry(item),
        })
        .collect()
}

/// What a new user starts with: three modules that feed each other and two
/// combinations of them (repomix packs the code; ast-grep finds and rewrites
/// by structure; mcp-mermaid draws what repomix found).
pub fn starter() -> Hub {
    let d = data();
    let by_name: BTreeMap<&str, &Item> = d.modules.iter().map(|m| (m.name.as_str(), m)).collect();
    Hub {
        modules: d
            .starter
            .modules
            .iter()
            .filter_map(|n| by_name.get(n.as_str()).map(|item| entry(item)))
            .collect(),
        combos: d
            .starter
            .combos
            .iter()
            .map(|c| Combo {
                name: c.name.get(),
                goal: c.goal.get(),
                members: c
                    .members
                    .iter()
                    .map(|m| Member {
                        module: m.module.clone(),
                        role: m.role.get(),
                    })
                    .collect(),
                ai_fit: None,
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp;

    #[test]
    fn the_starter_set_feeds_itself_and_fits_well() {
        let hub = starter();
        assert_eq!(hub.modules.len(), 3);
        assert_eq!(hub.combos.len(), 2);
        for c in &hub.combos {
            for m in &c.members {
                assert!(
                    hub.modules.iter().any(|e| e.name == m.module),
                    "{}",
                    m.module
                );
                assert!(!m.role.is_empty());
            }
            let fit = super::super::fit::rule_fit(c, &hub.modules);
            assert!(fit.score >= 75, "{}: {}", c.name, fit.score);
        }
    }

    #[test]
    fn catalog_modules_are_valid_and_named_uniquely() {
        let all = modules();
        assert!(all.len() >= 20);
        let mut names: Vec<&str> = all.iter().map(|m| m.module.name.as_str()).collect();
        for m in &all {
            mcp::check_name(&m.module.name).unwrap();
            assert!(!m.module.description.is_empty(), "{}", m.id);
            if m.module.kind == ModuleKind::Mcp {
                mcp::check_config(&m.module.config).unwrap();
            } else {
                assert!(!m.module.guide.is_empty(), "{} needs a guide", m.id);
            }
            if let Some(s) = &m.module.source {
                assert!(s.license_ok && s.license.is_some(), "{}", m.id);
            }
        }
        names.sort();
        names.dedup();
        assert_eq!(names.len(), all.len());
    }

    #[test]
    fn every_text_has_both_languages() {
        for m in &data().modules {
            assert!(
                !m.description.ko.is_empty() && !m.description.en.is_empty(),
                "{}",
                m.id
            );
            assert_eq!(m.guide.ko.is_empty(), m.guide.en.is_empty(), "{}", m.id);
            assert_eq!(m.warnings.ko.len(), m.warnings.en.len(), "{}", m.id);
        }
    }

    /// The recommended MCP servers live in `mcp.rs` too (the MCP page and
    /// prompt suggestions): the file has to match them.
    #[test]
    fn recommended_servers_match_the_file() {
        let all = modules();
        for r in mcp::recommended() {
            let m = all
                .iter()
                .find(|m| m.id == r.id)
                .unwrap_or_else(|| panic!("{} missing from modules.json", r.id));
            assert_eq!(m.module.name, r.name);
            assert_eq!(m.module.config, r.config, "{}", r.id);
            assert_eq!(m.needs, r.needs, "{}", r.id);
        }
    }
}
