//! Bringing skills into the library from outside the user's projects: a
//! GitHub address (a repository, a folder or a SKILL.md), a folder on this
//! computer, pasted text, or a description that the user's own `claude -p`
//! writes a skill from.
//!
//! Every way previews first: which skills were found, their license (from
//! the nearest license file) and anything to look at before taking them in
//! (scripts, piped remote scripts, referral links). The user's library is
//! their own, so a missing or restrictive license is a warning, not a refusal.
//! A skill from GitHub keeps where it came from in its SKILL.md frontmatter
//! (`license`, `metadata.source`). Nothing fetched is run.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

use super::{Library, check_id, file_name, ops, source_path};
use crate::catalog::fetch::{self, Entry};
use crate::library::ItemKind;

/// More than this many files or bytes in one skill isn't taken in.
const MAX_FILES: usize = 200;
const MAX_BYTES: u64 = 5 * 1024 * 1024;
/// Skills listed from one address.
const MAX_SKILLS: usize = 100;
/// SKILL.md files read for the preview; the rest show their folder name.
const MAX_PREVIEW_READS: usize = 40;
const SCRIPT_EXTS: &[&str] = &[
    "py", "sh", "bash", "zsh", "js", "mjs", "cjs", "ts", "ps1", "psm1", "rb", "pl", "bat", "cmd",
    "exe", "dll", "so", "dylib", "jar",
];

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    /// The skill folder: a path in the repository, or on this computer.
    pub path: String,
    /// The library folder name it gets.
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub files: usize,
    pub bytes: u64,
    /// SPDX-like id from the nearest license file, if one was recognized.
    pub license: Option<String>,
    /// The license allows what the project's rules ask for (MIT, Apache...).
    pub license_ok: bool,
    pub license_path: Option<String>,
    /// The library already has a skill by this name.
    pub exists: bool,
    pub warnings: Vec<String>,
    /// Why it can't be taken in (too big, invalid name), if so.
    pub blocked: Option<String>,
}

/// Ids added, and `(path, reason)` for what wasn't.
pub type Outcome = (Vec<String>, Vec<(String, String)>);

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    /// GitHub only: `owner/repo` and the commit everything was read at.
    pub repo: Option<String>,
    pub commit: Option<String>,
    pub skills: Vec<Found>,
}

/// `owner/repo` and the segments after it (`tree|blob`, ref and path).
pub(crate) fn parse_url(input: &str) -> Result<(String, Vec<String>), String> {
    let bad = || {
        crate::tr!(
            "GitHub 주소를 읽지 못했어요. 예: https://github.com/owner/repo/tree/main/skills/name",
            "Couldn't read the GitHub address. E.g. https://github.com/owner/repo/tree/main/skills/name"
        )
    };
    let mut rest = input.trim().trim_end_matches('/');
    for prefix in ["https://", "http://"] {
        rest = rest.strip_prefix(prefix).unwrap_or(rest);
    }
    rest = rest.strip_prefix("www.").unwrap_or(rest);
    let rest = rest.split(['?', '#']).next().unwrap_or_default();
    let (raw, rest) = if let Some(r) = rest.strip_prefix("raw.githubusercontent.com/") {
        (true, r)
    } else {
        (false, rest.strip_prefix("github.com/").unwrap_or(rest))
    };
    let mut parts = rest.split('/').filter(|p| !p.is_empty());
    let owner = parts.next().ok_or_else(bad)?;
    let repo = parts.next().ok_or_else(bad)?.trim_end_matches(".git");
    let valid = |s: &str| {
        !s.is_empty()
            && !s.starts_with('.')
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    if !valid(owner) || !valid(repo) {
        return Err(bad());
    }
    let mut segments: Vec<String> = parts.map(str::to_string).collect();
    if !raw {
        match segments.first().map(String::as_str) {
            Some("tree" | "blob") => {
                segments.remove(0);
            }
            Some(_) => return Err(bad()),
            None => {}
        }
    }
    if segments.iter().any(|s| s == ".." || s == ".") {
        return Err(bad());
    }
    Ok((format!("{owner}/{repo}"), segments))
}

/// The folder a GitHub path points at: a SKILL.md's or other file's folder.
fn folder_of(path: &str, entries: &[Entry]) -> String {
    let is_file = entries.iter().any(|e| e.is_file() && e.path == path);
    if is_file {
        path.rsplit_once('/')
            .map_or(String::new(), |(p, _)| p.to_string())
    } else {
        path.to_string()
    }
}

fn under<'a>(entries: &'a [Entry], folder: &str) -> impl Iterator<Item = &'a Entry> + 'a {
    let prefix = if folder.is_empty() {
        String::new()
    } else {
        format!("{folder}/")
    };
    entries
        .iter()
        .filter(move |e| e.is_file() && e.path.starts_with(&prefix))
}

fn is_script(path: &str) -> bool {
    path.rsplit_once('.')
        .is_some_and(|(_, ext)| SCRIPT_EXTS.contains(&ext.to_ascii_lowercase().as_str()))
}

fn script_warning(count: usize) -> String {
    crate::tr!(
        "실행 파일·스크립트 {count}개가 들어 있어요. Claude가 실행할 수 있으니 내용을 확인해 주세요",
        "Holds {count} script or program files Claude may run; check them first"
    )
}

fn no_license_warning() -> String {
    crate::tr!(
        "라이선스 파일이 없어요. 공유·재배포 전에 작성자에게 확인해 주세요",
        "No license file: check with the author before sharing it"
    )
}

fn restrictive_warning(id: &str) -> String {
    crate::tr!(
        "{id} 라이선스예요. 나만 쓰는 건 괜찮지만 공유·재배포 조건을 확인해 주세요",
        "{id} license: fine for your own use, but check its terms before sharing",
    )
}

fn license_warnings(found: &mut Found) {
    match (&found.license, found.license_ok) {
        (_, true) => {}
        (None, _) if found.license_path.is_some() => found.warnings.push(crate::tr!(
            "라이선스를 알아보지 못했어요. 파일을 직접 확인해 주세요",
            "Couldn't recognize the license; please read the file"
        )),
        (None, _) => found.warnings.push(no_license_warning()),
        (Some(id), false) => found.warnings.push(restrictive_warning(id)),
    }
}

fn already(lib_dir: &Path, id: &str) -> bool {
    fs::symlink_metadata(source_path(lib_dir, ItemKind::Skill, id)).is_ok()
}

fn name_and_description(text: &str) -> (Option<String>, Option<String>) {
    let fm = crate::tools::frontmatter::parse(text).unwrap_or_default();
    (
        fm.get("name").cloned().filter(|n| !n.trim().is_empty()),
        fm.get("description")
            .cloned()
            .filter(|d| !d.trim().is_empty()),
    )
}

// ---------------------------------------------------------------------------
// GitHub

/// The skills at a GitHub address.
pub fn preview_github(lib: &Library, url: &str, token: Option<&str>) -> Result<Preview, String> {
    let (repo, segments) = parse_url(url)?;
    let agent = fetch::agent();
    let refs: Vec<&str> = segments.iter().map(String::as_str).collect();
    let (commit, used) = fetch::resolve(&agent, &repo, &refs)?;
    let path = segments[used..].join("/");
    let entries = fetch::tree(&agent, &repo, &commit, token)?;
    let folder = folder_of(&path, &entries);
    let prefix = if folder.is_empty() {
        String::new()
    } else {
        format!("{folder}/")
    };
    let mut folders: Vec<String> = entries
        .iter()
        .filter(|e| e.is_file())
        .filter_map(|e| {
            let dir = if e.path == "SKILL.md" {
                Some("")
            } else {
                e.path.strip_suffix("/SKILL.md")
            }?;
            (dir == folder || prefix.is_empty() || dir.starts_with(&prefix))
                .then(|| dir.to_string())
        })
        .filter(|d| !d.split('/').any(|s| s == "node_modules"))
        .collect();
    folders.sort();
    if folders.is_empty() {
        return Err(crate::tr!(
            "이 주소에서 SKILL.md를 찾지 못했어요",
            "No SKILL.md found at this address"
        ));
    }
    folders.truncate(MAX_SKILLS);

    let lib_dir = lib.library_dir();
    let repo_name = repo.rsplit('/').next().unwrap_or_default().to_string();
    let mut licenses: HashMap<String, (Option<&'static str>, bool)> = HashMap::new();
    let mut reads = 0;
    let mut skills = Vec::new();
    for dir in folders {
        let files: Vec<&Entry> = under(&entries, &dir).collect();
        let id = if dir.is_empty() {
            repo_name.clone()
        } else {
            dir.rsplit('/').next().unwrap_or_default().to_string()
        };
        let mut found = Found {
            path: dir.clone(),
            files: files.len(),
            bytes: files.iter().map(|e| e.size).sum(),
            exists: already(&lib_dir, &id),
            name: id.clone(),
            id: id.clone(),
            ..Found::default()
        };
        if let Some(lic) = fetch::license_for(&entries, &dir) {
            let (spdx, ok) = *licenses.entry(lic.path.clone()).or_insert_with(|| {
                fetch::raw_text(&agent, &repo, &commit, &lic.path)
                    .map(|t| fetch::classify_license(&t))
                    .unwrap_or((None, false))
            });
            found.license = spdx.map(str::to_string);
            found.license_ok = ok;
            found.license_path = Some(lic.path.clone());
        }
        license_warnings(&mut found);
        let scripts = files.iter().filter(|e| is_script(&e.path)).count();
        if scripts > 0 {
            found.warnings.push(script_warning(scripts));
        }
        if reads < MAX_PREVIEW_READS {
            reads += 1;
            let skill_md = if dir.is_empty() {
                "SKILL.md".to_string()
            } else {
                format!("{dir}/SKILL.md")
            };
            if let Ok(text) = fetch::raw_text(&agent, &repo, &commit, &skill_md) {
                let (name, description) = name_and_description(&text);
                found.name = name.unwrap_or(found.name);
                found.description = description;
                found.warnings.extend(fetch::content_warnings(&text));
            }
        }
        found.blocked = blocked(&found, files.iter().map(|e| e.size));
        skills.push(found);
    }
    Ok(Preview {
        repo: Some(repo),
        commit: Some(commit),
        skills,
    })
}

fn blocked(found: &Found, sizes: impl Iterator<Item = u64>) -> Option<String> {
    if check_id(&found.id).is_err() {
        return Some(crate::tr!(
            "폴더 이름을 라이브러리 이름으로 쓸 수 없어요",
            "The folder name can't be used as a library name"
        ));
    }
    let too_big = sizes.into_iter().any(|s| s > fetch::MAX_FILE);
    if found.files > MAX_FILES || found.bytes > MAX_BYTES || too_big {
        return Some(crate::tr!(
            "파일이 너무 많거나 커요 (최대 {MAX_FILES}개, 파일당 512KB, 합계 5MB)",
            "Too many or too large files (at most {MAX_FILES}, 512 KB each, 5 MB in all)"
        ));
    }
    None
}

/// Adds `license` and `metadata.source` to a SKILL.md's frontmatter unless
/// it has them; text without frontmatter gets one.
fn with_source(text: &str, id: &str, license: Option<&str>, source: &str) -> String {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let fm = crate::tools::frontmatter::parse(text);
    let Some(fm) = fm else {
        let mut head = format!("---\nname: {id}\n");
        if let Some(l) = license {
            head.push_str(&format!("license: {l}\n"));
        }
        head.push_str(&format!("metadata:\n  source: {source}\n---\n\n"));
        return head + text;
    };
    let mut lines: Vec<String> = text.lines().map(str::to_string).collect();
    // The closing `---` (frontmatter was parsed, so it exists).
    let Some(close) = lines.iter().skip(1).position(|l| l.trim_end() == "---") else {
        return text.to_string();
    };
    let close = close + 1;
    let mut add = Vec::new();
    if let (Some(l), None) = (license, fm.get("license")) {
        add.push(format!("license: {l}"));
    }
    match lines[1..close]
        .iter()
        .position(|l| l.trim_end() == "metadata:")
    {
        Some(at)
            if !lines[at + 2..close]
                .iter()
                .any(|l| l.trim_start().starts_with("source:")) =>
        {
            let at = at + 1;
            let indent: String = lines
                .get(at + 1)
                .filter(|l| l.starts_with([' ', '\t']))
                .map(|l| l.chars().take_while(|c| c.is_whitespace()).collect())
                .unwrap_or_else(|| "  ".into());
            lines.insert(at + 1, format!("{indent}source: {source}"));
            let close = close + 1;
            lines.splice(close..close, add);
            return lines.join("\n") + "\n";
        }
        Some(_) => {}
        None if !fm.contains_key("metadata") => {
            add.push("metadata:".into());
            add.push(format!("  source: {source}"));
        }
        None => {}
    }
    lines.splice(close..close, add);
    lines.join("\n") + "\n"
}

/// Writes `files` (`relative path → bytes`) as library skill `id`, only once
/// they are all in place.
fn write_skill(lib_dir: &Path, id: &str, files: Vec<(String, Vec<u8>)>) -> Result<(), String> {
    check_id(id)?;
    let dest = source_path(lib_dir, ItemKind::Skill, id);
    if fs::symlink_metadata(&dest).is_ok() {
        return Err(crate::tr!(
            "라이브러리에 같은 이름이 이미 있습니다: {id}",
            "The library already has something named {id}"
        ));
    }
    let staging = lib_dir.join("skills").join(format!(".{id}.importing"));
    ops::remove_path(&staging)?;
    let result = (|| {
        for (rel, bytes) in &files {
            if rel.is_empty()
                || rel.contains('\\')
                || rel
                    .split('/')
                    .any(|s| s.is_empty() || s == ".." || s == "." || s.contains(':'))
            {
                continue;
            }
            let file = staging.join(rel);
            if let Some(parent) = file.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(&file, bytes).map_err(|e| e.to_string())?;
        }
        fs::rename(&staging, &dest).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = ops::remove_path(&staging);
    }
    result
}

/// Takes the chosen skill folders of `repo` at `commit` into the library.
/// Returns the ids added and `(folder, reason)` for the ones that weren't.
pub fn import_github(
    lib: &Library,
    repo: &str,
    commit: &str,
    folders: &[String],
    token: Option<&str>,
) -> Result<Outcome, String> {
    let (repo, _) = parse_url(repo)?;
    if commit.len() != 40 || !commit.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("invalid commit".into());
    }
    let agent = fetch::agent();
    let entries = fetch::tree(&agent, &repo, commit, token)?;
    let lib_dir = lib.library_dir();
    let repo_name = repo.rsplit('/').next().unwrap_or_default().to_string();
    let mut added = Vec::new();
    let mut failed = Vec::new();
    for dir in folders {
        let one = (|| -> Result<String, String> {
            let skill_md = if dir.is_empty() {
                "SKILL.md".to_string()
            } else {
                format!("{dir}/SKILL.md")
            };
            if !entries.iter().any(|e| e.is_file() && e.path == skill_md) {
                return Err(crate::tr!("SKILL.md가 없어요", "No SKILL.md"));
            }
            let id = if dir.is_empty() {
                repo_name.clone()
            } else {
                dir.rsplit('/').next().unwrap_or_default().to_string()
            };
            let files: Vec<&Entry> = under(&entries, dir).collect();
            let probe = Found {
                id: id.clone(),
                files: files.len(),
                bytes: files.iter().map(|e| e.size).sum(),
                ..Found::default()
            };
            if let Some(why) = blocked(&probe, files.iter().map(|e| e.size)) {
                return Err(why);
            }
            let license = fetch::license_for(&entries, dir)
                .and_then(|l| fetch::raw_text(&agent, &repo, commit, &l.path).ok())
                .and_then(|t| fetch::classify_license(&t).0);
            let source = if dir.is_empty() {
                format!("https://github.com/{repo}/tree/{commit}")
            } else {
                format!("https://github.com/{repo}/tree/{commit}/{dir}")
            };
            let prefix_len = if dir.is_empty() { 0 } else { dir.len() + 1 };
            let mut out = Vec::new();
            for e in files {
                let rel = e.path[prefix_len..].to_string();
                let mut bytes = fetch::raw(&agent, &repo, commit, &e.path)?;
                if rel == "SKILL.md" {
                    let text = String::from_utf8_lossy(&bytes).into_owned();
                    bytes = with_source(&text, &id, license, &source).into_bytes();
                }
                out.push((rel, bytes));
            }
            write_skill(&lib_dir, &id, out)?;
            Ok(id)
        })();
        match one {
            Ok(id) => added.push(id),
            Err(e) => failed.push((dir.clone(), e)),
        }
    }
    Ok((added, failed))
}

// ---------------------------------------------------------------------------
// A folder on this computer

fn skill_dirs(root: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if out.len() >= MAX_SKILLS {
        return;
    }
    if root.join("SKILL.md").is_file() {
        out.push(root.to_path_buf());
        return;
    }
    if depth == 0 {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter(|e| {
            let n = e.file_name();
            let n = n.to_string_lossy();
            !matches!(n.as_ref(), ".git" | "node_modules" | "target")
        })
        .map(|e| e.path())
        .collect();
    dirs.sort();
    for dir in dirs {
        skill_dirs(&dir, depth - 1, out);
    }
}

fn walk_files(dir: &Path, out: &mut Vec<(PathBuf, u64)>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let Ok(t) = e.file_type() else { continue };
        if t.is_symlink() {
            continue;
        }
        if t.is_dir() {
            if e.file_name() != ".git" {
                walk_files(&e.path(), out);
            }
        } else if t.is_file() {
            out.push((e.path(), e.metadata().map(|m| m.len()).unwrap_or(0)));
        }
        if out.len() > MAX_FILES {
            return;
        }
    }
}

/// The nearest license file in `dir` or a folder above it, up to `root`.
fn local_license(dir: &Path, root: &Path) -> Option<PathBuf> {
    let mut at = Some(dir);
    while let Some(d) = at {
        let found = fs::read_dir(d).ok()?.flatten().find(|e| {
            e.file_type().is_ok_and(|t| t.is_file())
                && fetch::is_license_file(&e.file_name().to_string_lossy())
        });
        if let Some(f) = found {
            return Some(f.path());
        }
        if d == root {
            break;
        }
        at = d.parent();
    }
    None
}

/// The skills in a folder: the folder itself if it holds a SKILL.md,
/// otherwise skill folders up to three levels down.
pub fn preview_folder(lib: &Library, path: &Path) -> Result<Preview, String> {
    if !path.is_dir() {
        return Err(crate::tr!(
            "폴더가 없어요: {}",
            "No such folder: {}",
            path.display()
        ));
    }
    let mut dirs = Vec::new();
    skill_dirs(path, 3, &mut dirs);
    if dirs.is_empty() {
        return Err(crate::tr!(
            "이 폴더에서 SKILL.md를 찾지 못했어요",
            "No SKILL.md found in this folder"
        ));
    }
    let lib_dir = lib.library_dir();
    let skills = dirs
        .into_iter()
        .map(|dir| {
            let mut files = Vec::new();
            walk_files(&dir, &mut files);
            let id = file_name(&dir).unwrap_or_default();
            let text = ops::read_text(&dir.join("SKILL.md")).unwrap_or_default();
            let (name, description) = name_and_description(&text);
            let mut found = Found {
                path: dir.display().to_string(),
                name: name.unwrap_or_else(|| id.clone()),
                description,
                files: files.len(),
                bytes: files.iter().map(|(_, s)| s).sum(),
                exists: already(&lib_dir, &id),
                id,
                ..Found::default()
            };
            if let Some(lic) = local_license(&dir, path) {
                let (spdx, ok) = ops::read_text(&lic)
                    .map(|t| fetch::classify_license(&t))
                    .unwrap_or((None, false));
                found.license = spdx.map(str::to_string);
                found.license_ok = ok;
                found.license_path = Some(lic.display().to_string());
            }
            // A folder of one's own needn't have a license; only a known
            // restrictive one is worth a word.
            if let (Some(id), false) = (&found.license, found.license_ok) {
                found.warnings.push(restrictive_warning(id));
            }
            let scripts = files
                .iter()
                .filter(|(p, _)| is_script(&p.to_string_lossy()))
                .count();
            if scripts > 0 {
                found.warnings.push(script_warning(scripts));
            }
            found.warnings.extend(fetch::content_warnings(&text));
            found.blocked = blocked(&found, files.iter().map(|(_, s)| *s));
            found
        })
        .collect();
    Ok(Preview {
        repo: None,
        commit: None,
        skills,
    })
}

/// Copies the chosen skill folders into the library.
pub fn import_folders(lib: &Library, paths: &[String]) -> Outcome {
    let lib_dir = lib.library_dir();
    let mut added = Vec::new();
    let mut failed = Vec::new();
    for path in paths {
        let dir = Path::new(path);
        let one = (|| -> Result<String, String> {
            if !dir.join("SKILL.md").is_file() {
                return Err(crate::tr!("SKILL.md가 없어요", "No SKILL.md"));
            }
            let id = file_name(dir).unwrap_or_default();
            let mut files = Vec::new();
            walk_files(dir, &mut files);
            let probe = Found {
                id: id.clone(),
                files: files.len(),
                bytes: files.iter().map(|(_, s)| s).sum(),
                ..Found::default()
            };
            if let Some(why) = blocked(&probe, files.iter().map(|(_, s)| *s)) {
                return Err(why);
            }
            let mut out = Vec::new();
            for (file, _) in files {
                let rel = file
                    .strip_prefix(dir)
                    .map_err(|e| e.to_string())?
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join("/");
                out.push((rel, fs::read(&file).map_err(|e| e.to_string())?));
            }
            write_skill(&lib_dir, &id, out)?;
            Ok(id)
        })();
        match one {
            Ok(id) => added.push(id),
            Err(e) => failed.push((path.clone(), e)),
        }
    }
    (added, failed)
}

// ---------------------------------------------------------------------------
// Text: pasted or written by `claude -p`

/// Saves `text` as library skill `id`. Text without frontmatter gets a
/// `name` and a `description` from its first line.
pub fn create(lib: &Library, id: &str, text: &str) -> Result<String, String> {
    let id = id.trim();
    check_id(id)?;
    let text = text.trim();
    if text.is_empty() {
        return Err(crate::tr!("내용이 비어 있어요", "The text is empty"));
    }
    let text = if crate::tools::frontmatter::parse(text).is_some() {
        format!("{text}\n")
    } else {
        let first = text
            .lines()
            .map(|l| l.trim().trim_start_matches('#').trim())
            .find(|l| !l.is_empty())
            .unwrap_or(id);
        let description: String = crate::catalog::blocks::first_sentence(first)
            .replace('"', "'")
            .chars()
            .take(300)
            .collect();
        format!("---\nname: {id}\ndescription: \"{description}\"\n---\n\n{text}\n")
    };
    write_skill(
        &lib.library_dir(),
        id,
        vec![("SKILL.md".into(), text.into_bytes())],
    )?;
    Ok(id.to_string())
}

const GENERATE_SYSTEM: &str = "You write Claude Code skills. Reply with the complete contents of one SKILL.md file and nothing else: no code fences, no commentary. Start with YAML frontmatter between --- lines holding `name` (lowercase letters, digits and hyphens, at most 64 characters) and `description` (one or two sentences in English saying what the skill does and when Claude should use it, starting with what it does). After the frontmatter write concise, concrete Markdown instructions for Claude: when to use it, the steps, and what to check. Keep it under 150 lines. Do not include scripts, commands that download and run remote code, links, or anything that sends data elsewhere. Write the instructions in the language of the request.";

const GENERATE_TIMEOUT: Duration = Duration::from_secs(180);

/// Asks the user's own `claude -p` (no tools, no MCP servers, nothing saved)
/// for a SKILL.md from a description.
pub fn generate(dir: &Path, request: &str) -> Result<String, String> {
    let request = request.trim();
    if request.is_empty() {
        return Err(crate::tr!(
            "어떤 skill인지 적어 주세요",
            "Describe the skill first"
        ));
    }
    let args = [
        "-p",
        "--output-format",
        "json",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--tools",
        "",
        "--system-prompt",
        GENERATE_SYSTEM,
    ];
    let (ok, stdout, stderr) = crate::tools::cli::run_with_input(
        crate::tools::ToolId::Claude,
        dir,
        &args,
        Some(request.to_string()),
        GENERATE_TIMEOUT,
    )?;
    let value: serde_json::Value = serde_json::from_str(stdout.trim()).unwrap_or_default();
    let result = value["result"].as_str().unwrap_or_default();
    if !ok || value["is_error"].as_bool() == Some(true) || result.trim().is_empty() {
        let why = [result, stderr.trim(), stdout.trim()]
            .into_iter()
            .find(|s| !s.is_empty())
            .unwrap_or("claude failed");
        return Err(why.lines().next().unwrap_or_default().to_string());
    }
    Ok(strip_fence(result))
}

/// Drops a code fence the model wrapped the file in anyway.
fn strip_fence(text: &str) -> String {
    let t = text.trim();
    let Some(rest) = t.strip_prefix("```") else {
        return format!("{t}\n");
    };
    let rest = rest.split_once('\n').map_or("", |(_, r)| r);
    let inner = rest.trim_end().strip_suffix("```").unwrap_or(rest);
    format!("{}\n", inner.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str) -> Entry {
        Entry {
            path: path.into(),
            kind: "blob".into(),
            size: 10,
        }
    }

    #[test]
    fn reads_github_addresses() {
        let p = |u: &str| parse_url(u).map(|(r, s)| (r, s.join("/")));
        assert_eq!(
            p("https://github.com/o/r").unwrap(),
            ("o/r".into(), "".into())
        );
        assert_eq!(p("o/r.git").unwrap(), ("o/r".into(), "".into()));
        assert_eq!(
            p("https://github.com/o/r/tree/main/skills/x/").unwrap(),
            ("o/r".into(), "main/skills/x".into())
        );
        assert_eq!(
            p("github.com/o/r/blob/v1/skills/x/SKILL.md?plain=1").unwrap(),
            ("o/r".into(), "v1/skills/x/SKILL.md".into())
        );
        assert_eq!(
            p("https://raw.githubusercontent.com/o/r/main/x/SKILL.md").unwrap(),
            ("o/r".into(), "main/x/SKILL.md".into())
        );
        assert!(p("https://github.com/o/r/pulls").is_err());
        assert!(p("https://github.com/o").is_err());
        assert!(p("https://github.com/o/r/tree/main/../x").is_err());
        assert!(p("https://github.com/../r").is_err());
    }

    #[test]
    fn a_skill_md_address_means_its_folder() {
        let entries = vec![entry("skills/x/SKILL.md"), entry("skills/x/ref.md")];
        assert_eq!(folder_of("skills/x/SKILL.md", &entries), "skills/x");
        assert_eq!(folder_of("skills/x", &entries), "skills/x");
        assert_eq!(under(&entries, "skills/x").count(), 2);
        assert_eq!(under(&entries, "skills/xy").count(), 0);
    }

    #[test]
    fn source_goes_into_the_frontmatter() {
        let out = with_source(
            "---\nname: x\ndescription: d\n---\n# Body\n",
            "x",
            Some("MIT"),
            "https://github.com/o/r/tree/abc/x",
        );
        assert_eq!(
            out,
            "---\nname: x\ndescription: d\nlicense: MIT\nmetadata:\n  source: https://github.com/o/r/tree/abc/x\n---\n# Body\n"
        );
        let fm = crate::tools::frontmatter::parse(&out).unwrap();
        assert_eq!(fm["name"], "x");

        // Existing license and metadata are kept; the source joins metadata.
        let out = with_source(
            "---\nname: x\nlicense: Apache-2.0\nmetadata:\n    author: a\n---\nB\n",
            "x",
            Some("MIT"),
            "S",
        );
        assert_eq!(
            out,
            "---\nname: x\nlicense: Apache-2.0\nmetadata:\n    source: S\n    author: a\n---\nB\n"
        );

        // No frontmatter: one is added.
        let out = with_source("# Just text\n", "y", None, "S");
        assert!(out.starts_with("---\nname: y\nmetadata:\n  source: S\n---\n"));
    }

    #[test]
    fn folders_preview_and_import() {
        let tmp = tempfile::tempdir().unwrap();
        let lib = Library::for_tests(tmp.path().join("data"));
        let src = tmp.path().join("src");
        fs::create_dir_all(src.join("pack/one/ref")).unwrap();
        fs::create_dir_all(src.join("pack/two")).unwrap();
        fs::create_dir_all(src.join("pack/not-a-skill")).unwrap();
        fs::write(
            src.join("pack/one/SKILL.md"),
            "---\nname: one\ndescription: First.\n---\nDo one.\n",
        )
        .unwrap();
        fs::write(src.join("pack/one/ref/notes.md"), "notes").unwrap();
        fs::write(src.join("pack/one/run.py"), "print(1)").unwrap();
        fs::write(src.join("pack/two/SKILL.md"), "Plain").unwrap();
        fs::write(
            src.join("pack/LICENSE"),
            "MIT License\nPermission is hereby granted, free of charge",
        )
        .unwrap();

        let preview = preview_folder(&lib, &src.join("pack")).unwrap();
        let ids: Vec<_> = preview.skills.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["one", "two"]);
        let one = &preview.skills[0];
        assert_eq!(one.description.as_deref(), Some("First."));
        assert_eq!(one.files, 3);
        assert_eq!(one.license.as_deref(), Some("MIT"));
        assert!(one.license_ok);
        assert_eq!(one.warnings.len(), 1, "{:?}", one.warnings);

        let paths: Vec<String> = preview.skills.iter().map(|s| s.path.clone()).collect();
        let (added, failed) = import_folders(&lib, &paths);
        assert_eq!(added, ["one", "two"]);
        assert!(failed.is_empty());
        let dir = lib.library_dir().join("skills");
        assert!(dir.join("one/ref/notes.md").is_file());
        assert!(dir.join("two/SKILL.md").is_file());
        // Taking the same ones again is refused, and nothing half-done stays.
        let (added, failed) = import_folders(&lib, &paths);
        assert!(added.is_empty());
        assert_eq!(failed.len(), 2);
        assert!(!dir.join(".one.importing").exists());
        assert!(preview_folder(&lib, &src.join("pack")).unwrap().skills[0].exists);
    }

    #[test]
    fn pasted_text_becomes_a_skill() {
        let tmp = tempfile::tempdir().unwrap();
        let lib = Library::for_tests(tmp.path().join("data"));
        create(&lib, "tidy", "# Keep things tidy. Always.\nSteps...").unwrap();
        let text = fs::read_to_string(lib.library_dir().join("skills/tidy/SKILL.md")).unwrap();
        let fm = crate::tools::frontmatter::parse(&text).unwrap();
        assert_eq!(fm["name"], "tidy");
        assert_eq!(fm["description"], "Keep things tidy.");
        assert!(create(&lib, "tidy", "x").is_err());
        assert!(create(&lib, "../x", "x").is_err());
        assert!(create(&lib, "empty", "  ").is_err());

        create(&lib, "own", "---\nname: own\ndescription: Mine\n---\nBody").unwrap();
        let text = fs::read_to_string(lib.library_dir().join("skills/own/SKILL.md")).unwrap();
        assert_eq!(text, "---\nname: own\ndescription: Mine\n---\nBody\n");
    }

    #[test]
    fn strips_a_wrapping_fence() {
        assert_eq!(
            strip_fence("```markdown\n---\nname: a\n---\nB\n```"),
            "---\nname: a\n---\nB\n"
        );
        assert_eq!(
            strip_fence("---\nname: a\n---\nB"),
            "---\nname: a\n---\nB\n"
        );
    }
}
