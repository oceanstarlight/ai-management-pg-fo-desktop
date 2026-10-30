//! What has been settled for each project (platform, language, stack...):
//! found in Claude's answers by Haiku, or written by the user, kept by the app
//! and, when the user says so, written into the project's `CLAUDE.md`. The
//! mod reads them through the export to suggest and to refine prompts.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::mpsc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

type Result<T> = std::result::Result<T, String>;

/// Emitted with `{ project }` when a project's decisions change.
pub const EVENT: &str = "decisions-changed";

const FILE: &str = "decisions.json";
/// Decisions kept per project, at most.
const MAX_PER_PROJECT: usize = 60;
/// Answers shorter than this settle nothing worth asking about.
const MIN_ANSWER: usize = 40;
/// The answer's head and tail read for decisions.
const MAX_ANSWER: usize = 6000;

const START: &str = "<!-- encela:decisions:start -->";
const END: &str = "<!-- encela:decisions:end -->";

const SYSTEM: &str = "You read one exchange between a developer and Claude Code and list the project decisions it settles: platform, programming language, framework, libraries, database, hosting or deployment, styling, testing, architecture, conventions. Only firm choices that were decided or confirmed, not options being weighed. Reuse a topic from the known decisions when the exchange changes it. Reply with a JSON array only: [{\"topic\":\"short English noun phrase\",\"value\":\"short\"}], or [] when nothing is settled.";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    pub id: String,
    pub topic: String,
    pub value: String,
    /// `auto` (found by Haiku) or `user`.
    pub source: String,
    /// Epoch milliseconds.
    pub at: i64,
    /// Written into `CLAUDE.md` as it is now.
    #[serde(default)]
    pub in_claude_md: bool,
}

static LOCK: Mutex<()> = Mutex::new(());

fn path(data_dir: &Path) -> PathBuf {
    data_dir.join(FILE)
}

fn read_all(data_dir: &Path) -> BTreeMap<String, Vec<Decision>> {
    fs::read(path(data_dir))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_all(data_dir: &Path, all: &BTreeMap<String, Vec<Decision>>) -> Result<()> {
    let text = serde_json::to_string(all).map_err(|e| e.to_string())?;
    crate::library::ops::write_atomic(&path(data_dir), text)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

fn new_id() -> String {
    format!("d{}", uuid::Uuid::new_v4().simple())
}

/// Adds what Haiku found: a known topic gets the new value (unless the user
/// wrote it), a new one is added. Returns whether anything changed.
fn merge(list: &mut Vec<Decision>, found: Vec<(String, String)>, at: i64) -> bool {
    let mut changed = false;
    for (topic, value) in found {
        let (topic, value) = (topic.trim(), value.trim());
        if topic.is_empty() || value.is_empty() || topic.len() > 80 || value.len() > 200 {
            continue;
        }
        match list
            .iter_mut()
            .find(|d| d.topic.eq_ignore_ascii_case(topic))
        {
            Some(d) if d.source == "user" || d.value == value => {}
            Some(d) => {
                d.value = value.to_string();
                d.at = at;
                d.in_claude_md = false;
                changed = true;
            }
            None => {
                list.push(Decision {
                    id: new_id(),
                    topic: topic.to_string(),
                    value: value.to_string(),
                    source: "auto".into(),
                    at,
                    in_claude_md: false,
                });
                changed = true;
            }
        }
    }
    if list.len() > MAX_PER_PROJECT {
        list.sort_by_key(|d| std::cmp::Reverse(d.at));
        list.truncate(MAX_PER_PROJECT);
    }
    changed
}

/// The `[{topic, value}]` in Haiku's reply.
fn parse_reply(text: &str) -> Vec<(String, String)> {
    let (Some(start), Some(end)) = (text.find('['), text.rfind(']')) else {
        return Vec::new();
    };
    if end < start {
        return Vec::new();
    }
    let value: serde_json::Value = serde_json::from_str(&text[start..=end]).unwrap_or_default();
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|d| {
            Some((
                d["topic"].as_str()?.to_string(),
                d["value"].as_str()?.to_string(),
            ))
        })
        .collect()
}

fn clip(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= MAX_ANSWER {
        return text.to_string();
    }
    let half = MAX_ANSWER / 2;
    let head: String = chars[..half].iter().collect();
    let tail: String = chars[chars.len() - half..].iter().collect();
    format!("{head}\n…\n{tail}")
}

fn ask(known: &[Decision], prompt: &str, answer: &str) -> String {
    let known: Vec<String> = known
        .iter()
        .map(|d| format!("- {}: {}", d.topic, d.value))
        .collect();
    format!(
        "Known decisions:\n{}\n\nThe developer wrote:\n<<<\n{}\n>>>\n\nClaude Code answered:\n<<<\n{}\n>>>\n\nJSON array only.",
        if known.is_empty() {
            "(none)".to_string()
        } else {
            known.join("\n")
        },
        crate::activity::redact::prompt_text(prompt),
        crate::activity::redact::prompt_text(&clip(answer)),
    )
}

/// The `topic: value` lines of every project, for the mod.
pub fn lines_by_project(app: &AppHandle) -> BTreeMap<String, Vec<String>> {
    let Ok(data_dir) = app.path().app_data_dir() else {
        return BTreeMap::new();
    };
    read_all(&data_dir)
        .into_iter()
        .filter(|(_, list)| !list.is_empty())
        .map(|(project, list)| {
            let lines = list
                .iter()
                .map(|d| format!("{}: {}", d.topic, d.value))
                .collect();
            (project, lines)
        })
        .collect()
}

fn changed(app: &AppHandle, project: &str) {
    crate::bridge::changed();
    let _ = app.emit(EVENT, serde_json::json!({ "project": project }));
}

struct Job {
    project: String,
    prompt: String,
    answer: String,
}

static QUEUE: Mutex<Option<mpsc::Sender<Job>>> = Mutex::new(None);

/// One worker reads answers in order, so two never race on the file.
fn queue(app: &AppHandle) -> mpsc::Sender<Job> {
    let mut q = QUEUE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(tx) = q.as_ref() {
        return tx.clone();
    }
    let (tx, rx) = mpsc::channel::<Job>();
    let app = app.clone();
    std::thread::spawn(move || {
        for job in rx {
            let _ = find(&app, job);
        }
    });
    *q = Some(tx.clone());
    tx
}

fn find(app: &AppHandle, job: Job) -> Result<()> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let known = read_all(&data_dir).remove(&job.project).unwrap_or_default();
    let dir = crate::suggest::run_dir(app, Some(&job.project))?;
    let reply = crate::suggest::haiku(&dir, SYSTEM, ask(&known, &job.prompt, &job.answer))?;
    let found = parse_reply(&reply);
    if found.is_empty() {
        return Ok(());
    }
    let did = {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut all = read_all(&data_dir);
        let list = all.entry(job.project.clone()).or_default();
        let did = merge(list, found, now_ms());
        if did {
            write_all(&data_dir, &all)?;
        }
        did
    };
    if did {
        changed(app, &job.project);
    }
    Ok(())
}

pub fn apply_request(app: &AppHandle, request: crate::bridge::Request) {
    let crate::bridge::Request::TurnAnswer {
        project,
        prompt,
        answer,
        ..
    } = request
    else {
        return;
    };
    if project.is_empty()
        || answer.trim().chars().count() < MIN_ANSWER
        || crate::prefs::get(app, crate::suggest::PREF).as_deref() == Some("off")
    {
        return;
    }
    let _ = queue(app).send(Job {
        project,
        prompt,
        answer,
    });
}

/// The decisions section of `CLAUDE.md`.
fn section(list: &[Decision]) -> String {
    let mut out = format!("{START}\n## Project decisions\n\n");
    for d in list {
        out.push_str(&format!("- **{}**: {}\n", d.topic, d.value));
    }
    out.push_str(END);
    out
}

/// `text` with its decisions section replaced, or added at the end.
fn with_section(text: &str, list: &[Decision]) -> String {
    let new = section(list);
    if let (Some(start), Some(end)) = (text.find(START), text.find(END))
        && end > start
    {
        return format!("{}{}{}", &text[..start], new, &text[end + END.len()..]);
    }
    if text.trim().is_empty() {
        return format!("{new}\n");
    }
    format!("{}\n\n{new}\n", text.trim_end())
}

// ---------------------------------------------------------------------------
// Commands

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn decisions_list(app: AppHandle, project: String) -> Result<Vec<Decision>> {
    blocking(move || {
        let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        Ok(read_all(&data_dir).remove(&project).unwrap_or_default())
    })
    .await
}

/// Replaces a project's decisions with the user's edit: a changed or new one
/// becomes the user's (Haiku no longer overwrites it).
#[tauri::command]
pub async fn decisions_save(
    app: AppHandle,
    project: String,
    decisions: Vec<Decision>,
) -> Result<Vec<Decision>> {
    let saved = blocking({
        let app = app.clone();
        let project = project.clone();
        move || {
            let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let mut all = read_all(&data_dir);
            let old = all.remove(&project).unwrap_or_default();
            let now = now_ms();
            let list: Vec<Decision> = decisions
                .into_iter()
                .filter(|d| !d.topic.trim().is_empty() && !d.value.trim().is_empty())
                .map(|mut d| {
                    d.topic = d.topic.trim().to_string();
                    d.value = d.value.trim().to_string();
                    match old.iter().find(|o| o.id == d.id) {
                        Some(o) if o.topic == d.topic && o.value == d.value => o.clone(),
                        _ => Decision {
                            id: if d.id.is_empty() { new_id() } else { d.id },
                            source: "user".into(),
                            at: now,
                            in_claude_md: false,
                            ..d
                        },
                    }
                })
                .collect();
            if !list.is_empty() {
                all.insert(project.clone(), list.clone());
            }
            write_all(&data_dir, &all)?;
            Ok(list)
        }
    })
    .await?;
    changed(&app, &project);
    Ok(saved)
}

/// Writes the decisions into the project's `CLAUDE.md` (its own section,
/// the rest of the file kept). Returns the file's path.
#[tauri::command]
pub async fn decisions_apply(app: AppHandle, project: String) -> Result<String> {
    let file = blocking({
        let app = app.clone();
        let project = project.clone();
        move || {
            let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let root = PathBuf::from(&project);
            if !root.is_dir() {
                return Err(crate::tr!(
                    "프로젝트 폴더가 없어요.",
                    "The project folder doesn't exist."
                ));
            }
            let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let mut all = read_all(&data_dir);
            let list = all.entry(project).or_default();
            let file = root.join("CLAUDE.md");
            let text = fs::read_to_string(&file).unwrap_or_default();
            crate::library::ops::write_atomic(&file, with_section(&text, list))?;
            for d in list.iter_mut() {
                d.in_claude_md = true;
            }
            write_all(&data_dir, &all)?;
            Ok(file.to_string_lossy().into_owned())
        }
    })
    .await?;
    changed(&app, &project);
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(topic: &str, value: &str, source: &str) -> Decision {
        Decision {
            id: new_id(),
            topic: topic.into(),
            value: value.into(),
            source: source.into(),
            at: 1,
            in_claude_md: true,
        }
    }

    #[test]
    fn found_decisions_update_auto_ones_and_keep_the_users() {
        let mut list = vec![
            d("Framework", "React", "auto"),
            d("Database", "MySQL", "user"),
        ];
        let found = vec![
            ("framework".into(), "Next.js".into()),
            ("database".into(), "Postgres".into()),
            ("Platform".into(), "Web".into()),
            ("".into(), "x".into()),
        ];
        assert!(merge(&mut list, found, 5));
        assert_eq!(list[0].value, "Next.js");
        assert!(!list[0].in_claude_md);
        assert_eq!(list[1].value, "MySQL");
        assert_eq!(list[2].topic, "Platform");
        assert!(!merge(
            &mut list,
            vec![("Platform".into(), "Web".into())],
            6
        ));
    }

    #[test]
    fn replies_are_read_from_the_json_array() {
        assert_eq!(
            parse_reply("Here: [{\"topic\":\"Language\",\"value\":\"TypeScript\"}]"),
            [("Language".to_string(), "TypeScript".to_string())]
        );
        assert!(parse_reply("[]").is_empty());
        assert!(parse_reply("nothing").is_empty());
    }

    #[test]
    fn the_claude_md_section_is_replaced_in_place() {
        let list = [d("Language", "Rust", "auto")];
        let first = with_section("# App\n\nRules.\n", &list);
        assert!(first.starts_with("# App\n\nRules.\n\n<!-- encela"));
        assert!(first.contains("- **Language**: Rust"));
        let list = [d("Language", "Go", "user")];
        let second = with_section(&format!("{first}\nAfter.\n"), &list);
        assert!(second.contains("- **Language**: Go") && !second.contains("Rust"));
        assert!(second.ends_with("After.\n"));
        assert_eq!(second.matches(START).count(), 1);
        assert_eq!(with_section("", &list), format!("{}\n", section(&list)));
    }

    #[test]
    fn long_answers_keep_head_and_tail() {
        let long = "a".repeat(MAX_ANSWER) + &"b".repeat(MAX_ANSWER);
        let c = clip(&long);
        assert!(c.starts_with('a') && c.ends_with('b') && c.contains('…'));
        assert!(c.chars().count() < MAX_ANSWER + 10);
    }
}
