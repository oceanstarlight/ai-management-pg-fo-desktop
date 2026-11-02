//! Writes one catalog block into a project for Claude Code, for the user only
//! (prompt suggestions): skills, subagents and rules as their own files under
//! `.claude`, instructions as a marked section of `CLAUDE.local.md`, hooks
//! merged into `.claude/settings.local.json`. Files are git-excluded. A file
//! the user already has under the same name is never overwritten.

use std::fs;
use std::io;
use std::path::{Component, Path};

use serde::Serialize;

use super::blocks::{Block, BlockKind, Origin};
use crate::library::ops;

type Result<T> = std::result::Result<T, String>;

const LOCAL_MD: &str = "CLAUDE.local.md";
const SETTINGS: &str = ".claude/settings.local.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    /// The file written (or already there), relative to the project.
    pub path: String,
    /// The project already had it exactly like this.
    pub unchanged: bool,
}

/// Whether a block can be written into a project from a suggestion: the
/// empty "write your own" hook can't.
pub fn suggestible(block: &Block) -> bool {
    !(block.kind == BlockKind::Hook && (block.body.trim().is_empty() || block.event.is_none()))
}

/// Writes `block` into `project`. Hooks are the caller's to confirm first.
pub fn apply(project: &Path, block: &Block) -> Result<Applied> {
    if !project.is_dir() {
        return Err(crate::tr!(
            "프로젝트 폴더가 없어요: {}",
            "The project folder doesn't exist: {}",
            project.display()
        ));
    }
    if !suggestible(block) {
        return Err(crate::tr!(
            "이 블록은 직접 채워야 해서 바로 추가할 수 없어요",
            "This block has to be filled in first, so it can't be added as is"
        ));
    }
    let name = safe_name(&block.name)?;
    match block.kind {
        BlockKind::Skill => {
            let dir = format!(".claude/skills/{name}");
            let mut files = vec![("SKILL.md".to_string(), skill_file(block))];
            for (rel, text) in &block.companions {
                files.push((safe_rel(rel)?, (*text).to_string()));
            }
            let unchanged = write_new_files(project, &dir, &files)?;
            ops::exclude_add(&project.join(&dir), true)?;
            Ok(Applied {
                path: format!("{dir}/SKILL.md"),
                unchanged,
            })
        }
        BlockKind::Agent => whole_file(
            project,
            &format!(".claude/agents/{name}.md"),
            &agent_file(block),
        ),
        BlockKind::Rule => whole_file(
            project,
            &format!(".claude/rules/{name}.md"),
            &rule_file(block),
        ),
        BlockKind::Instruction => instruction(project, block),
        BlockKind::Hook => hook(project, block),
    }
}

/// A block name used as a file or folder name: no paths, nothing hidden.
fn safe_name(name: &str) -> Result<&str> {
    let ok = !name.is_empty()
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if ok {
        Ok(name)
    } else {
        Err(crate::tr!(
            "블록 이름을 파일 이름으로 쓸 수 없어요: {name}",
            "The block's name can't be used as a file name: {name}"
        ))
    }
}

/// A companion file's path, kept inside the skill's folder.
fn safe_rel(rel: &str) -> Result<String> {
    let path = Path::new(rel);
    if rel.is_empty() || !path.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(crate::tr!(
            "스킬 동반 파일 경로가 올바르지 않아요: {rel}",
            "A skill's companion file has a bad path: {rel}"
        ));
    }
    Ok(rel.replace('\\', "/"))
}

fn read(path: &Path) -> Result<Option<String>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// Line endings aside, the same text.
fn same(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    norm(a).trim_end() == norm(b).trim_end()
}

fn exists_error(rel: &str) -> String {
    crate::tr!(
        "같은 이름의 파일이 이미 있어서 건드리지 않았어요: {rel}",
        "Left alone: the project already has a file by this name: {rel}"
    )
}

/// Writes `files` (relative to `dir`) when none of them exists with other
/// text. Returns whether all were already there.
fn write_new_files(project: &Path, dir: &str, files: &[(String, String)]) -> Result<bool> {
    let mut todo = Vec::new();
    for (rel, text) in files {
        let path = project.join(dir).join(rel);
        match read(&path)? {
            Some(old) if same(&old, text) => {}
            Some(_) => return Err(exists_error(&format!("{dir}/{rel}"))),
            None => todo.push((path, text)),
        }
    }
    let unchanged = todo.is_empty();
    for (path, text) in todo {
        ops::write_atomic(&path, text)?;
    }
    Ok(unchanged)
}

fn whole_file(project: &Path, rel: &str, text: &str) -> Result<Applied> {
    let path = project.join(rel);
    let unchanged = match read(&path)? {
        Some(old) if same(&old, text) => true,
        Some(_) => return Err(exists_error(rel)),
        None => {
            ops::write_atomic(&path, text)?;
            false
        }
    };
    ops::exclude_add(&path, false)?;
    Ok(Applied {
        path: rel.to_string(),
        unchanged,
    })
}

fn origin_url(o: &Origin) -> String {
    format!("https://github.com/{}/blob/{}/{}", o.repo, o.commit, o.path)
}

/// YAML double-quoted scalar, safe for any text.
fn quoted(s: &str) -> String {
    let escaped = s
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', " ");
    format!("\"{escaped}\"")
}

/// A YAML comment crediting a third-party block, for frontmatter.
fn credit_comment(block: &Block) -> String {
    block
        .origin
        .as_ref()
        .map(|o| {
            format!(
                "# Source: {} ({}, {})\n",
                origin_url(o),
                o.license,
                o.copyright
            )
        })
        .unwrap_or_default()
}

fn description(block: &Block) -> &str {
    block
        .description
        .as_deref()
        .filter(|d| !d.trim().is_empty())
        .unwrap_or(&block.summary)
}

fn skill_file(block: &Block) -> String {
    let mut fm = format!(
        "---\nname: {}\ndescription: {}\n",
        block.name,
        quoted(description(block))
    );
    if block.manual {
        fm.push_str("disable-model-invocation: true\n");
    }
    if let Some(o) = &block.origin {
        fm.push_str(&format!(
            "license: {}\nmetadata:\n  source: {}\n  copyright: {}\n",
            o.license,
            quoted(&origin_url(o)),
            quoted(&o.copyright)
        ));
    }
    format!("{fm}---\n\n{}\n", block.body.trim_end())
}

fn agent_file(block: &Block) -> String {
    let mut fm = format!(
        "---\n{}name: {}\ndescription: {}\n",
        credit_comment(block),
        block.name,
        quoted(description(block))
    );
    if let Some(tools) = block.tools.as_deref().filter(|t| !t.is_empty()) {
        fm.push_str(&format!("tools: {tools}\n"));
    }
    if let Some(model) = block.model.as_deref().filter(|m| !m.is_empty()) {
        fm.push_str(&format!("model: {model}\n"));
    }
    format!("{fm}---\n\n{}\n", block.body.trim_end())
}

fn rule_file(block: &Block) -> String {
    let body = block.body.trim_end();
    let credit = credit_comment(block);
    if block.paths.is_empty() && credit.is_empty() {
        return format!("{body}\n");
    }
    let mut fm = format!("---\n{credit}");
    if !block.paths.is_empty() {
        fm.push_str("paths:\n");
        for p in &block.paths {
            fm.push_str(&format!("  - {}\n", quoted(p)));
        }
    }
    format!("{fm}---\n\n{body}\n")
}

fn marker(id: &str) -> String {
    format!("<!-- encela:block {id} -->")
}

const END_MARKER: &str = "<!-- /encela:block -->";

/// The instruction as a marked section of `CLAUDE.local.md`, added once.
/// A project that only had AGENTS.md keeps loading it: Claude Code reads
/// AGENTS.md only when there is no CLAUDE.md of any kind.
fn instruction(project: &Path, block: &Block) -> Result<Applied> {
    let path = project.join(LOCAL_MD);
    let old = read(&path)?;
    let start = marker(&block.id);
    if old.as_deref().is_some_and(|t| t.contains(&start)) {
        ops::exclude_add(&path, false)?;
        return Ok(Applied {
            path: LOCAL_MD.into(),
            unchanged: true,
        });
    }
    let newline = match &old {
        Some(t) if t.contains("\r\n") => "\r\n",
        _ => "\n",
    };
    let credit = block
        .origin
        .as_ref()
        .map(|o| {
            format!(
                "<!-- Source: {} ({}, {}) -->\n",
                origin_url(o),
                o.license,
                o.copyright
            )
        })
        .unwrap_or_default();
    let section = format!("{start}\n{credit}{}\n{END_MARKER}\n", block.body.trim());
    let mut text = match old {
        Some(t) => {
            let mut t = t;
            if !t.is_empty() && !t.ends_with('\n') {
                t.push_str(newline);
            }
            if !t.trim().is_empty() {
                t.push_str(newline);
            }
            t
        }
        None if keeps_agents_md(project) => "@AGENTS.md\n\n".into(),
        None => String::new(),
    };
    text.push_str(&section.replace('\n', newline));
    ops::write_atomic(&path, text)?;
    ops::exclude_add(&path, false)?;
    Ok(Applied {
        path: LOCAL_MD.into(),
        unchanged: false,
    })
}

fn keeps_agents_md(project: &Path) -> bool {
    project.join("AGENTS.md").is_file()
        && !["CLAUDE.md", LOCAL_MD, ".claude/CLAUDE.md"]
            .iter()
            .any(|f| project.join(f).is_file())
}

/// Adds the hook to `.claude/settings.local.json`, keeping everything else.
fn hook(project: &Path, block: &Block) -> Result<Applied> {
    use serde_json::{Map, Value};
    let path = project.join(SETTINGS);
    let old = read(&path)?;
    let not_json = || {
        crate::tr!(
            "{SETTINGS}이 올바른 JSON 객체가 아니라 건드리지 않았어요",
            "Left untouched: {SETTINGS} isn't a valid JSON object"
        )
    };
    let base: Value = match &old {
        Some(t) if !t.trim().is_empty() => {
            serde_json::from_str(t.trim_start_matches('\u{feff}')).map_err(|_| not_json())?
        }
        _ => Value::Object(Map::new()),
    };
    let Value::Object(mut settings) = base.clone() else {
        return Err(not_json());
    };
    let mut hooks = match settings.remove("hooks") {
        None => Map::new(),
        Some(Value::Object(h)) => h,
        Some(_) => return Err(not_json()),
    };
    let event = block.event.as_deref().unwrap_or_default();
    add_hook(
        &mut hooks,
        event,
        block.matcher.as_deref(),
        block.body.trim(),
    );
    settings.insert("hooks".into(), Value::Object(hooks));
    let merged = Value::Object(settings);
    let unchanged = old.is_some() && merged == base;
    if !unchanged {
        let text = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())? + "\n";
        let text = match &old {
            Some(o) if o.contains("\r\n") => text.replace('\n', "\r\n"),
            _ => text,
        };
        ops::write_atomic(&path, text)?;
    }
    ops::exclude_add(&path, false)?;
    Ok(Applied {
        path: SETTINGS.into(),
        unchanged,
    })
}

/// Adds one command hook under `event` (and `matcher`), next to the others
/// with the same matcher, as settings.json lays them out.
fn add_hook(
    hooks: &mut serde_json::Map<String, serde_json::Value>,
    event: &str,
    matcher: Option<&str>,
    command: &str,
) {
    use serde_json::{Value, json};
    let groups = hooks
        .entry(event.to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    let Some(groups) = groups.as_array_mut() else {
        return;
    };
    let same = |g: &Value| g.get("matcher").and_then(Value::as_str) == matcher;
    let index = match groups.iter().position(same) {
        Some(i) => i,
        None => {
            let mut group = serde_json::Map::new();
            if let Some(m) = matcher {
                group.insert("matcher".into(), json!(m));
            }
            group.insert("hooks".into(), json!([]));
            groups.push(Value::Object(group));
            groups.len() - 1
        }
    };
    let hook = json!({ "type": "command", "command": command });
    if let Some(list) = groups[index].get_mut("hooks").and_then(Value::as_array_mut)
        && !list.contains(&hook)
    {
        list.push(hook);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::blocks;

    fn project(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("encela-apply-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(".git/info")).unwrap();
        dir
    }

    fn find(kind: BlockKind) -> Block {
        blocks::all(&[], None)
            .into_iter()
            .find(|b| b.kind == kind && suggestible(b))
            .unwrap()
    }

    #[test]
    fn writes_each_kind_once_and_excludes_it() {
        let root = project("kinds");
        for kind in [
            BlockKind::Skill,
            BlockKind::Agent,
            BlockKind::Rule,
            BlockKind::Instruction,
            BlockKind::Hook,
        ] {
            let block = find(kind);
            let first = apply(&root, &block).unwrap();
            assert!(!first.unchanged, "{kind:?}");
            assert!(root.join(&first.path).is_file(), "{}", first.path);
            let again = apply(&root, &block).unwrap();
            assert!(again.unchanged, "{kind:?} wrote twice");
        }
        let exclude = fs::read_to_string(root.join(".git/info/exclude")).unwrap();
        assert!(exclude.contains("/CLAUDE.local.md"), "{exclude}");
        assert!(
            exclude.contains("/.claude/settings.local.json"),
            "{exclude}"
        );
        assert!(exclude.contains("/.claude/skills/"), "{exclude}");
    }

    #[test]
    fn never_overwrites_the_users_file() {
        let root = project("keep");
        let block = find(BlockKind::Rule);
        let rel = format!(".claude/rules/{}.md", block.name);
        fs::create_dir_all(root.join(".claude/rules")).unwrap();
        fs::write(root.join(&rel), "mine\n").unwrap();
        assert!(apply(&root, &block).is_err());
        assert_eq!(fs::read_to_string(root.join(&rel)).unwrap(), "mine\n");
    }

    #[test]
    fn instruction_keeps_user_text_and_agents_md() {
        let root = project("instr");
        fs::write(root.join("AGENTS.md"), "# Agents\n").unwrap();
        let block = find(BlockKind::Instruction);
        apply(&root, &block).unwrap();
        let text = fs::read_to_string(root.join(LOCAL_MD)).unwrap();
        assert!(text.starts_with("@AGENTS.md\n"), "{text}");
        assert!(text.contains(&marker(&block.id)));

        let root = project("instr2");
        fs::write(root.join(LOCAL_MD), "my notes").unwrap();
        apply(&root, &block).unwrap();
        let text = fs::read_to_string(root.join(LOCAL_MD)).unwrap();
        assert!(text.starts_with("my notes\n\n<!-- encela:block"), "{text}");
        assert!(text.trim_end().ends_with(END_MARKER));
    }

    #[test]
    fn hook_merges_and_keeps_other_keys() {
        let root = project("hook");
        fs::create_dir_all(root.join(".claude")).unwrap();
        fs::write(
            root.join(SETTINGS),
            r#"{"permissions":{"allow":["Bash(ls)"]},"hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo hi"}]}]}}"#,
        )
        .unwrap();
        let block = find(BlockKind::Hook);
        apply(&root, &block).unwrap();
        let v: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(root.join(SETTINGS)).unwrap()).unwrap();
        assert_eq!(v["permissions"]["allow"][0], "Bash(ls)");
        let event = block.event.as_deref().unwrap();
        let text = v["hooks"][event].to_string();
        assert!(
            text.contains(&serde_json::to_string(block.body.trim()).unwrap()),
            "{text}"
        );
        assert!(v["hooks"]["Stop"].to_string().contains("echo hi"));

        fs::write(root.join(SETTINGS), "[1]").unwrap();
        assert!(apply(&root, &block).is_err());
    }

    #[test]
    fn names_and_companion_paths_stay_inside() {
        assert!(safe_name("../x").is_err());
        assert!(safe_name(".hidden").is_err());
        assert!(safe_name("a/b").is_err());
        assert!(safe_name("code-review_2.x").is_ok());
        assert!(safe_rel("../x.md").is_err());
        assert!(safe_rel("/abs.md").is_err());
        assert!(safe_rel("references/a.md").is_ok());
    }

    #[test]
    fn custom_hook_is_not_suggestible() {
        let custom = blocks::builtin()
            .into_iter()
            .find(|b| b.id == "builtin:hook-custom")
            .unwrap();
        assert!(!suggestible(&custom));
    }
}
