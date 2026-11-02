//! "새로 발견": skills and subagents that appeared upstream next to the
//! third-party blocks the app bundles.
//!
//! Only the repositories the catalog already takes from are looked at, and
//! only the same kind of file in the same folder as a bundled block (a
//! sibling `<folder>/<name>/SKILL.md`, or `<folder>/<name>.md` for
//! subagents). A find must carry the license the source was bundled under
//! (a folder's own license file wins over the repository's), and a skill
//! folder must hold nothing but its SKILL.md and license, since only
//! Markdown is ever taken in and nothing is run.
//!
//! Finds wait in `catalog-cache/discovered.json` with their upstream text
//! until the user reads one and takes it in or hides it: the content check
//! the project's rules ask for is the user's. Taken-in blocks live in
//! `catalog-cache/found/<source>__<stem>.md` (provenance in frontmatter),
//! follow upstream through "최신 받아오기" and sync with the account.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::blocks::{self as catalog, BlockKind};
use super::fetch::{self, Entry};
use super::refresh::license_matches;
use crate::library::ops;

const STATE_FILE: &str = "discovered.json";
/// Upstream files fetched per check; the rest wait for the next one.
const FETCH_PER_RUN: usize = 30;
/// Bigger texts aren't offered (the catalog warns from 12 KB already).
const MAX_TEXT: u64 = 64 * 1024;
/// How long finds stay in the list unread.
const MAX_CANDIDATES: usize = 200;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    /// `<source>__<stem>`, also the found file's name.
    pub id: String,
    pub source: String,
    pub stem: String,
    pub kind: BlockKind,
    pub name: String,
    pub description: String,
    pub repo: String,
    pub commit: String,
    pub path: String,
    pub license_path: String,
    pub license: String,
    pub copyright: String,
    pub category: String,
    pub category_en: String,
    #[serde(default)]
    pub adapt: Option<String>,
    #[serde(default)]
    pub tools: Option<String>,
    /// Things to look at before taking it in (remote scripts, links...).
    #[serde(default)]
    pub warnings: Vec<String>,
    pub size: usize,
    pub found_at: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    /// Epoch ms of the last finished check, 0 before the first.
    #[serde(default)]
    pub checked_at: i64,
    #[serde(default)]
    pub candidates: Vec<Candidate>,
    /// `repo:path` of finds the user hid or took back out.
    #[serde(default)]
    pub dismissed: Vec<String>,
    /// Sources that couldn't be checked last time: `(repo, reason)`.
    #[serde(default)]
    pub failed: Vec<(String, String)>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

pub fn load(cache: &Path) -> State {
    fs::read(cache.join(STATE_FILE))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save(cache: &Path, state: &State) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?;
    ops::write_atomic(&cache.join(STATE_FILE), json)
}

pub fn found_dir(cache: &Path) -> PathBuf {
    cache.join("found")
}

fn text_dir(cache: &Path) -> PathBuf {
    cache.join("candidates")
}

/// `(source, stem)` of a found file's stem.
pub fn split_id(id: &str) -> Option<(&str, &str)> {
    let (source, stem) = id.split_once("__")?;
    (crate::library::check_id(source).is_ok() && crate::library::check_id(stem).is_ok())
        .then_some((source, stem))
}

/// The blocks taken in from "새로 발견": `(file, source, stem, text)`.
pub fn found_files(cache: &Path) -> Vec<(PathBuf, String, String, String)> {
    let Ok(entries) = fs::read_dir(found_dir(cache)) else {
        return Vec::new();
    };
    let mut out: Vec<_> = entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let stem = path.file_name()?.to_str()?.strip_suffix(".md")?.to_string();
            let (source, name) = split_id(&stem)?;
            let (source, name) = (source.to_string(), name.to_string());
            let text = fs::read_to_string(&path).ok()?;
            Some((path, source, name, text))
        })
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

/// Whether `text` is a found block the catalog would read, for copies that
/// arrive through sync.
pub fn valid_found(id: &str, text: &str) -> bool {
    let Some((source, stem)) = split_id(id) else {
        return false;
    };
    catalog::parse_external(source, stem, text)
        .and_then(|b| b.origin)
        .is_some_and(|o| matches!(o.license.as_str(), "MIT" | "Apache-2.0"))
}

/// Where a bundled source looks for new files.
#[derive(Clone, Debug)]
struct Pattern {
    source: String,
    repo: String,
    kind: BlockKind,
    /// The folder the sibling files sit in ("" for the repository root).
    container: String,
    /// The bundled block's license file is inside its own folder, so a new
    /// one must have its own too.
    per_item_license: bool,
    license: String,
    copyright: String,
    category: String,
    category_en: String,
    adapt: Option<String>,
}

fn parent(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(p, _)| p)
}

fn patterns() -> Vec<Pattern> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for (source, stem, text) in catalog::bundled_external() {
        let Some(block) = catalog::parse_external(source, stem, text) else {
            continue;
        };
        let Some(origin) = block.origin.as_ref() else {
            continue;
        };
        let (fm, _) = catalog::split(text);
        let license_path = fm.get("license_path").cloned().unwrap_or_default();
        let (container, per_item) = match block.kind {
            BlockKind::Skill if origin.path.ends_with("/SKILL.md") => {
                let folder = parent(&origin.path);
                (
                    parent(folder).to_string(),
                    license_path.starts_with(&format!("{folder}/")),
                )
            }
            BlockKind::Agent if origin.path.ends_with(".md") => {
                (parent(&origin.path).to_string(), false)
            }
            _ => continue,
        };
        if !seen.insert((source.to_string(), block.kind as u8, container.clone())) {
            continue;
        }
        let en = block.en.as_ref();
        out.push(Pattern {
            source: source.to_string(),
            repo: origin.repo.clone(),
            kind: block.kind,
            container,
            per_item_license: per_item,
            license: origin.license.clone(),
            copyright: origin.copyright.clone(),
            category: block.category.clone(),
            category_en: en.map(|e| e.category.clone()).unwrap_or_default(),
            adapt: fm.get("adapt").cloned(),
        });
    }
    out
}

/// A file a pattern could take: `(stem, upstream path)`.
fn matches(pattern: &Pattern, entries: &[Entry]) -> Vec<(String, String)> {
    let prefix = if pattern.container.is_empty() {
        String::new()
    } else {
        format!("{}/", pattern.container)
    };
    let mut out = Vec::new();
    for e in entries.iter().filter(|e| e.is_file()) {
        let Some(rest) = e.path.strip_prefix(&prefix) else {
            continue;
        };
        match pattern.kind {
            BlockKind::Skill => {
                let Some(name) = rest.strip_suffix("/SKILL.md") else {
                    continue;
                };
                if name.contains('/') {
                    continue;
                }
                let folder = format!("{prefix}{name}/");
                // Only SKILL.md and license files: anything else (scripts,
                // references) would be left behind.
                let only_markdown = entries.iter().filter(|x| x.is_file()).all(|x| {
                    match x.path.strip_prefix(&folder) {
                        Some(file) => file == "SKILL.md" || fetch::is_license_file(file),
                        None => true,
                    }
                });
                if only_markdown && e.size <= MAX_TEXT {
                    out.push((name.to_string(), e.path.clone()));
                }
            }
            BlockKind::Agent => {
                let Some(name) = rest.strip_suffix(".md") else {
                    continue;
                };
                let lower = name.to_ascii_lowercase();
                if name.contains('/')
                    || matches!(
                        lower.as_str(),
                        "readme" | "index" | "contributing" | "changelog" | "license" | "agents"
                    )
                    || e.size > MAX_TEXT
                {
                    continue;
                }
                out.push((name.to_string(), e.path.clone()));
            }
            _ => {}
        }
    }
    out
}

/// The license file a find is covered by, if it is the one the source was
/// bundled under (or the find's own).
fn license_path_for(pattern: &Pattern, entries: &[Entry], path: &str) -> Option<String> {
    let dir = parent(path);
    let found = fetch::license_for(entries, dir)?;
    if pattern.per_item_license && parent(&found.path) != dir {
        return None;
    }
    Some(found.path.clone())
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverResult {
    /// Finds added this time.
    pub added: usize,
    /// Finds waiting for the user.
    pub waiting: usize,
    pub failed: Vec<(String, String)>,
}

/// Looks for new files in every source repository. `token` is the
/// signed-in GitHub token, for the API's higher limit.
pub fn discover(cache: &Path, token: Option<&str>) -> DiscoverResult {
    let mut state = load(cache);
    let mut result = DiscoverResult::default();

    // Everything already known: bundled, taken in, waiting or hidden.
    let mut known: HashSet<String> = state.dismissed.iter().cloned().collect();
    let mut stems: HashSet<(String, String)> = HashSet::new();
    for (source, stem, text) in catalog::bundled_external() {
        stems.insert((source.to_string(), stem.to_string()));
        if let Some(o) = catalog::parse_external(source, stem, text).and_then(|b| b.origin) {
            known.insert(format!("{}:{}", o.repo, o.path));
        }
    }
    for (_, source, stem, text) in found_files(cache) {
        stems.insert((source.clone(), stem.clone()));
        if let Some(o) = catalog::parse_external(&source, &stem, &text).and_then(|b| b.origin) {
            known.insert(format!("{}:{}", o.repo, o.path));
        }
    }
    for c in &state.candidates {
        stems.insert((c.source.clone(), c.stem.clone()));
        known.insert(format!("{}:{}", c.repo, c.path));
    }

    let mut by_repo: BTreeMap<String, Vec<Pattern>> = BTreeMap::new();
    for p in patterns() {
        by_repo.entry(p.repo.clone()).or_default().push(p);
    }

    let agent = fetch::agent();
    let mut budget = FETCH_PER_RUN;
    for (repo, patterns) in by_repo {
        if budget == 0 {
            break;
        }
        let entries = match fetch::latest_commit(&agent, &repo)
            .and_then(|commit| Ok((fetch::tree(&agent, &repo, &commit, token)?, commit)))
        {
            Ok(x) => x,
            Err(e) => {
                result.failed.push((repo, e));
                continue;
            }
        };
        let (entries, commit) = entries;
        let mut licenses: HashMap<String, bool> = HashMap::new();
        for pattern in &patterns {
            for (stem, path) in matches(pattern, &entries) {
                if budget == 0 {
                    break;
                }
                let key = format!("{repo}:{path}");
                if known.contains(&key)
                    || crate::library::check_id(&stem).is_err()
                    || stem.contains("__")
                    || stems.contains(&(pattern.source.clone(), stem.clone()))
                {
                    continue;
                }
                let Some(license_path) = license_path_for(pattern, &entries, &path) else {
                    continue;
                };
                let license_ok = *licenses.entry(license_path.clone()).or_insert_with(|| {
                    budget = budget.saturating_sub(1);
                    fetch::raw_text(&agent, &repo, &commit, &license_path)
                        .is_ok_and(|t| license_matches(&pattern.license, &t))
                });
                if !license_ok || budget == 0 {
                    continue;
                }
                budget -= 1;
                let Ok(text) = fetch::raw_text(&agent, &repo, &commit, &path) else {
                    continue;
                };
                let Some(candidate) =
                    candidate(pattern, &stem, &path, &commit, &license_path, &text)
                else {
                    continue;
                };
                if ops::write_atomic(&text_dir(cache).join(format!("{}.md", candidate.id)), &text)
                    .is_err()
                {
                    continue;
                }
                known.insert(key);
                stems.insert((pattern.source.clone(), stem));
                state.candidates.push(candidate);
                result.added += 1;
            }
        }
    }
    state.candidates.truncate(MAX_CANDIDATES);
    state.checked_at = now_ms();
    state.failed = result.failed.clone();
    result.waiting = state.candidates.len();
    if let Err(e) = save(cache, &state) {
        result.failed.push((String::new(), e));
    }
    result
}

fn clean(s: &str) -> String {
    s.replace('"', "'")
        .replace(['\n', '\r'], " ")
        .trim()
        .to_string()
}

fn candidate(
    pattern: &Pattern,
    stem: &str,
    path: &str,
    commit: &str,
    license_path: &str,
    text: &str,
) -> Option<Candidate> {
    let (fm, body) = catalog::split(text);
    let description = clean(fm.get("description")?);
    if description.is_empty() || body.trim().is_empty() {
        return None;
    }
    let name = fm
        .get("name")
        .map(|n| n.trim().to_string())
        .filter(|n| crate::library::check_id(n).is_ok())
        .unwrap_or_else(|| stem.to_string());
    Some(Candidate {
        id: format!("{}__{stem}", pattern.source),
        source: pattern.source.clone(),
        stem: stem.to_string(),
        kind: pattern.kind,
        name,
        description,
        repo: pattern.repo.clone(),
        commit: commit.to_string(),
        path: path.to_string(),
        license_path: license_path.to_string(),
        license: pattern.license.clone(),
        copyright: pattern.copyright.clone(),
        category: pattern.category.clone(),
        category_en: pattern.category_en.clone(),
        adapt: pattern.adapt.clone(),
        tools: fm.get("tools").map(|t| clean(t)),
        warnings: fetch::content_warnings(text),
        size: body.len(),
        found_at: now_ms(),
    })
}

/// A waiting find's upstream text, to read before taking it in.
pub fn text(cache: &Path, id: &str) -> Result<String, String> {
    split_id(id).ok_or_else(|| not_found(id))?;
    fs::read_to_string(text_dir(cache).join(format!("{id}.md"))).map_err(|_| not_found(id))
}

fn not_found(id: &str) -> String {
    crate::tr!("목록에 없는 항목이에요: {id}", "Not in the list: {id}")
}

/// The catalog file of a find: the app's frontmatter (provenance included)
/// and the upstream body.
fn found_text(c: &Candidate, upstream: &str) -> String {
    let (_, body) = catalog::split(upstream);
    let summary = catalog::first_sentence(&c.description);
    let kind = match c.kind {
        BlockKind::Skill => "skill",
        _ => "agent",
    };
    let mut out = format!(
        "---\nkind: {kind}\ntitle: {name}\ntitle_en: {name}\nsummary: {summary}\nsummary_en: {summary}\ncategory: {}\ncategory_en: {}\n",
        c.category,
        c.category_en,
        name = c.name,
        summary = clean(&summary),
    );
    if summary != c.description {
        out.push_str(&format!(
            "detail: {d}\ndetail_en: {d}\n",
            d = clean(&c.description)
        ));
    }
    out.push_str(&format!(
        "name: {}\ndescription: \"{}\"\n",
        c.name, c.description
    ));
    if let Some(tools) = &c.tools {
        out.push_str(&format!("tools: {tools}\n"));
    }
    if let Some(adapt) = &c.adapt {
        out.push_str(&format!("adapt: {adapt}\n"));
    }
    out.push_str(&format!(
        "license: {}\ncopyright: \"{}\"\nsource_repo: {}\nsource_commit: {}\nsource_path: {}\nlicense_path: {}\n---\n{}\n",
        c.license,
        clean(&c.copyright),
        c.repo,
        c.commit,
        c.path,
        c.license_path,
        body.trim_end()
    ));
    out
}

/// Takes a find into the catalog.
pub fn accept(cache: &Path, id: &str) -> Result<String, String> {
    let mut state = load(cache);
    let at = state
        .candidates
        .iter()
        .position(|c| c.id == id)
        .ok_or_else(|| not_found(id))?;
    let upstream = text(cache, id)?;
    let c = state.candidates.remove(at);
    let file = found_dir(cache).join(format!("{id}.md"));
    let written = found_text(&c, &upstream);
    // The catalog must read it back, or it would silently not show.
    catalog::parse_external(&c.source, &c.stem, &written)
        .ok_or_else(|| crate::tr!("형식을 읽지 못했어요", "Couldn't parse it"))?;
    ops::write_atomic(&file, written)?;
    let _ = fs::remove_file(text_dir(cache).join(format!("{id}.md")));
    save(cache, &state)?;
    Ok(c.name)
}

/// Hides a waiting find for good.
pub fn dismiss(cache: &Path, id: &str) -> Result<(), String> {
    let mut state = load(cache);
    let at = state
        .candidates
        .iter()
        .position(|c| c.id == id)
        .ok_or_else(|| not_found(id))?;
    let c = state.candidates.remove(at);
    state.dismissed.push(format!("{}:{}", c.repo, c.path));
    let _ = fs::remove_file(text_dir(cache).join(format!("{id}.md")));
    save(cache, &state)
}

/// Takes a block taken in from "새로 발견" back out of the catalog; it isn't
/// offered again.
pub fn remove_found(cache: &Path, id: &str) -> Result<(), String> {
    let (source, stem) = split_id(id).ok_or_else(|| not_found(id))?;
    let file = found_dir(cache).join(format!("{id}.md"));
    let text = fs::read_to_string(&file).map_err(|_| not_found(id))?;
    let mut state = load(cache);
    if let Some(o) = catalog::parse_external(source, stem, &text).and_then(|b| b.origin) {
        state.dismissed.push(format!("{}:{}", o.repo, o.path));
    }
    ops::remove_path(&file)?;
    save(cache, &state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, size: u64) -> Entry {
        Entry {
            path: path.into(),
            kind: "blob".into(),
            size,
        }
    }

    fn skill_pattern(per_item: bool) -> Pattern {
        Pattern {
            source: "src_x".into(),
            repo: "o/r".into(),
            kind: BlockKind::Skill,
            container: "skills".into(),
            per_item_license: per_item,
            license: "MIT".into(),
            copyright: "Copyright (c) X".into(),
            category: "디자인".into(),
            category_en: "Design".into(),
            adapt: None,
        }
    }

    #[test]
    fn every_bundled_source_with_skills_or_agents_has_a_pattern() {
        let all = patterns();
        assert!(all.iter().any(|p| p.kind == BlockKind::Skill));
        assert!(all.iter().any(|p| p.kind == BlockKind::Agent));
        // anthropics/skills keeps a license per skill folder.
        assert!(
            all.iter()
                .any(|p| p.repo == "anthropics/skills" && p.per_item_license)
        );
    }

    #[test]
    fn takes_markdown_only_skill_folders_and_plain_agent_files() {
        let entries = vec![
            file("LICENSE", 1),
            file("skills/a/SKILL.md", 10),
            file("skills/b/SKILL.md", 10),
            file("skills/b/scripts/run.py", 10),
            file("skills/c/SKILL.md", 10),
            file("skills/c/LICENSE.txt", 10),
            file("skills/nested/d/SKILL.md", 10),
            file("skills/big/SKILL.md", MAX_TEXT + 1),
        ];
        let found: Vec<_> = matches(&skill_pattern(false), &entries)
            .into_iter()
            .map(|(s, _)| s)
            .collect();
        assert_eq!(found, ["a", "c"]);

        let agents = Pattern {
            kind: BlockKind::Agent,
            container: "agents".into(),
            ..skill_pattern(false)
        };
        let entries = vec![
            file("agents/reviewer.md", 10),
            file("agents/README.md", 10),
            file("agents/sub/x.md", 10),
            file("agents/notes.txt", 10),
        ];
        let found: Vec<_> = matches(&agents, &entries)
            .into_iter()
            .map(|(s, _)| s)
            .collect();
        assert_eq!(found, ["reviewer"]);
    }

    #[test]
    fn per_item_license_must_be_in_the_folder() {
        let entries = vec![
            file("LICENSE", 1),
            file("skills/a/SKILL.md", 10),
            file("skills/c/SKILL.md", 10),
            file("skills/c/LICENSE.txt", 10),
        ];
        let p = skill_pattern(true);
        assert_eq!(license_path_for(&p, &entries, "skills/a/SKILL.md"), None);
        assert_eq!(
            license_path_for(&p, &entries, "skills/c/SKILL.md").as_deref(),
            Some("skills/c/LICENSE.txt")
        );
        assert_eq!(
            license_path_for(&skill_pattern(false), &entries, "skills/a/SKILL.md").as_deref(),
            Some("LICENSE")
        );
    }

    #[test]
    fn accepting_a_find_writes_a_catalog_block_with_provenance() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path();
        let upstream =
            "---\nname: tidy\ndescription: Keeps things tidy. Really.\n---\n# Tidy\nDo it.\n";
        let c = candidate(
            &skill_pattern(false),
            "tidy",
            "skills/tidy/SKILL.md",
            &"a".repeat(40),
            "LICENSE",
            upstream,
        )
        .unwrap();
        let id = c.id.clone();
        ops::write_atomic(&text_dir(cache).join(format!("{id}.md")), upstream).unwrap();
        save(
            cache,
            &State {
                candidates: vec![c],
                ..State::default()
            },
        )
        .unwrap();

        assert_eq!(accept(cache, &id).unwrap(), "tidy");
        assert!(load(cache).candidates.is_empty());
        let files = found_files(cache);
        assert_eq!(files.len(), 1);
        let block = catalog::parse_external(&files[0].1, &files[0].2, &files[0].3).unwrap();
        assert_eq!(block.kind, BlockKind::Skill);
        assert_eq!(block.body, "# Tidy\nDo it.");
        assert_eq!(block.summary, "Keeps things tidy.");
        let origin = block.origin.unwrap();
        assert_eq!(origin.repo, "o/r");
        assert_eq!(origin.license, "MIT");

        // Taking it back out hides it from later checks.
        remove_found(cache, &id).unwrap();
        assert!(found_files(cache).is_empty());
        assert_eq!(load(cache).dismissed, ["o/r:skills/tidy/SKILL.md"]);
    }

    #[test]
    fn ids_cannot_escape_the_cache() {
        assert!(split_id("../x__y").is_none());
        assert!(split_id("a__../b").is_none());
        assert!(split_id("plain").is_none());
        assert_eq!(split_id("src__name"), Some(("src", "name")));
    }

    /// Hits GitHub; run with `cargo test -- --ignored live_discover`.
    #[test]
    #[ignore]
    fn live_discover() {
        let tmp = tempfile::tempdir().unwrap();
        let result = discover(tmp.path(), None);
        println!("{result:#?}");
        for c in load(tmp.path()).candidates {
            println!("{} {} {:?}", c.id, c.license_path, c.warnings);
        }
    }
}
