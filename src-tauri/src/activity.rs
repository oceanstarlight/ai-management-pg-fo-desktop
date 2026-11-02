//! What Claude Code is doing right now, per session: the tools it calls
//! (which file it reads or edits, which command it runs), its turns, and the
//! session's context and cost. The mod sends steps through the bridge
//! (`Request::Activity`); cloud sessions arrive through the relay. Kept in
//! memory and never synced; written to `<app data>/resume.json` just before
//! an update restarts the app (and on quit) so the home page comes back as it was.

use std::collections::BTreeMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

/// Emitted with one `Session` when it changes.
pub const EVENT: &str = "session-activity";
/// Emitted with `{ session }` when a session is dropped.
pub const GONE_EVENT: &str = "session-activity-gone";

/// Steps kept per session (the timeline).
const MAX_STEPS: usize = 200;
/// Files kept per session in the map's counts.
const MAX_FILES: usize = 2000;
/// Sessions kept at once; the oldest ended ones go first.
const MAX_SESSIONS: usize = 8;
/// Ended sessions stay this long.
const ENDED_TTL_MS: i64 = 30 * 60 * 1000;
/// A command or description is cut to this many characters.
const MAX_DETAIL: usize = 200;
/// An answer is kept up to this many characters.
const MAX_ANSWER: usize = 8000;
/// A busy session whose mod pings (every few seconds while a turn runs) and
/// has gone quiet this long was stopped: Claude Code closed or was killed.
const STALE_MS: i64 = 15 * 1000;
/// The saved home page is used only if the app comes back within this.
const RESUME_TTL_MS: i64 = ENDED_TTL_MS;
const RESUME_FILE: &str = "resume.json";

/// One thing a session did, as the mod or the relay reports it.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Step {
    /// Epoch milliseconds.
    pub at: i64,
    /// `turn` (with `phase` start/end), `tool`, `toolEnd`, `usage` or `ping`
    /// (the mod is alive while a turn runs).
    pub kind: String,
    /// The tool call's or the turn's id.
    pub id: String,
    pub phase: String,
    pub tool: String,
    /// Set by the app from `tool`: read, search, edit, run, agent, plan, web,
    /// ask, mcp or other.
    pub category: String,
    /// The file (relative to the project) or pattern the tool works on.
    pub target: String,
    /// A command, search or subagent task, masked and cut.
    pub detail: String,
    /// The end of a main-loop turn: Claude's answer, masked and cut.
    pub answer: String,
    pub added: u32,
    pub removed: u32,
    /// `toolEnd`: whether the tool succeeded. A main turn's end: `false` when
    /// it was interrupted or failed.
    pub ok: Option<bool>,
    /// Set when a subagent made the call.
    pub agent: Option<String>,
    /// An Agent call's task (start), masked and cut: matches the subagent's
    /// first turn, which starts with it.
    pub prompt: String,
    /// `usage`: the context window used, 0-100.
    pub context_percent: Option<f64>,
    pub tokens: Option<u64>,
    pub cost_usd: Option<f64>,
    /// `usage`: the cost is the mod's estimate from token counts (the host
    /// keeps no cost ledger, e.g. the desktop app or VS Code).
    pub cost_estimated: Option<bool>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct FileStat {
    pub reads: u32,
    pub edits: u32,
    pub added: u32,
    pub removed: u32,
    pub last_at: i64,
    /// `read` or `edit`, whichever happened last.
    pub last: String,
}

/// This turn's counts.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Counters {
    pub tools: u32,
    pub reads: u32,
    pub edits: u32,
    pub commands: u32,
    pub searches: u32,
    pub agents: u32,
    pub failed: u32,
    pub added: u32,
    pub removed: u32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Usage {
    pub context_percent: Option<f64>,
    pub tokens: Option<u64>,
    pub cost_usd: Option<f64>,
    pub cost_estimated: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Session {
    pub session: String,
    pub project: String,
    pub surface: String,
    /// Came through the cloud relay.
    pub cloud: bool,
    /// idle, thinking, read, search, edit, run, agent, plan, web, mcp,
    /// other or ended.
    pub state: String,
    /// What the current tool works on, for the status line.
    pub doing: String,
    pub turn_started: Option<i64>,
    pub turns: u32,
    pub turn: Counters,
    pub steps: Vec<Step>,
    pub files: BTreeMap<String, FileStat>,
    pub usage: Usage,
    /// Epoch milliseconds of the last step.
    pub at: i64,
    /// When the last main turn was interrupted or the session went quiet
    /// mid-turn: the app shows it stopped for a moment, then idle.
    pub stopped_at: Option<i64>,
    /// The mod pings while a turn runs, so silence means it stopped.
    #[serde(skip)]
    pub pings: bool,
}

static SESSIONS: Mutex<Vec<Session>> = Mutex::new(Vec::new());

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

/// The kind of work a tool does, for colour and the status animation.
pub fn category(tool: &str) -> &'static str {
    match tool {
        "Read" | "NotebookRead" | "LS" => "read",
        "Grep" | "Glob" | "ToolSearch" => "search",
        "Edit" | "MultiEdit" | "Write" | "NotebookEdit" => "edit",
        "Bash" | "BashOutput" | "KillShell" | "PowerShell" | "Monitor" => "run",
        "Agent" | "Task" => "agent",
        "TodoWrite" | "TaskCreate" | "TaskUpdate" | "ExitPlanMode" | "EnterPlanMode" => "plan",
        "WebSearch" | "WebFetch" => "web",
        "AskUserQuestion" => "ask",
        t if t.starts_with("mcp__") => "mcp",
        _ => "other",
    }
}

fn clip(text: &str) -> String {
    let text = crate::redact::prompt_text(text);
    if text.chars().count() <= MAX_DETAIL {
        return text;
    }
    let mut out: String = text.chars().take(MAX_DETAIL - 1).collect();
    out.push('…');
    out
}

fn answer_text(text: &str) -> String {
    let text = crate::redact::mask(text.trim());
    if text.chars().count() <= MAX_ANSWER {
        return text;
    }
    let mut out: String = text.chars().take(MAX_ANSWER - 1).collect();
    out.push('…');
    out
}

/// A path the session reported, relative to the project when inside it, with
/// `/` separators.
fn relative(project: &str, target: &str) -> String {
    let norm = |p: &str| p.replace('\\', "/");
    let (p, t) = (norm(project), norm(target));
    let p = p.trim_end_matches('/');
    match t.strip_prefix(p) {
        Some(rest) if !p.is_empty() && rest.starts_with('/') => rest[1..].to_string(),
        _ => t,
    }
}

/// Folds one step into the session.
fn apply_step(s: &mut Session, mut step: Step) {
    let at = if step.at > 0 { step.at } else { now_ms() };
    step.at = at;
    s.at = s.at.max(at);
    match step.kind.as_str() {
        "turn" if step.phase == "start" => {
            if step.agent.is_none() {
                s.turn = Counters::default();
                s.turn_started = Some(at);
                s.turns += 1;
                s.state = "thinking".into();
                s.doing.clear();
                s.stopped_at = None;
            }
            step.detail = clip(&step.detail);
        }
        "turn" => {
            if step.agent.is_none() {
                s.state = "idle".into();
                s.doing.clear();
                s.stopped_at = (step.ok == Some(false)).then_some(at);
            }
            step.answer = answer_text(&step.answer);
        }
        "tool" => {
            step.category = category(&step.tool).into();
            step.detail = clip(&step.detail);
            step.prompt = clip(&step.prompt);
            if !step.target.is_empty() {
                step.target = relative(&s.project, &step.target);
            }
            s.turn.tools += 1;
            match step.category.as_str() {
                "read" => s.turn.reads += 1,
                "search" | "web" => s.turn.searches += 1,
                "run" => s.turn.commands += 1,
                "agent" => s.turn.agents += 1,
                _ => {}
            }
            if step.category == "read" && !step.target.is_empty() {
                let f = s.files.entry(step.target.clone()).or_default();
                f.reads += 1;
                f.last_at = at;
                f.last = "read".into();
            }
            s.state = step.category.clone();
            s.doing = if step.target.is_empty() {
                step.detail.clone()
            } else {
                step.target.clone()
            };
        }
        "toolEnd" => {
            if let Some(start) = s
                .steps
                .iter()
                .rev()
                .find(|x| x.kind == "tool" && x.id == step.id)
            {
                step.tool = start.tool.clone();
                step.category = start.category.clone();
                step.target = start.target.clone();
            }
            if step.ok == Some(false) {
                s.turn.failed += 1;
            } else if step.category == "edit" && !step.target.is_empty() {
                s.turn.edits += 1;
                s.turn.added += step.added;
                s.turn.removed += step.removed;
                let f = s.files.entry(step.target.clone()).or_default();
                f.edits += 1;
                f.added += step.added;
                f.removed += step.removed;
                f.last_at = at;
                f.last = "edit".into();
            }
            if s.state != "idle" {
                s.state = "thinking".into();
                s.doing.clear();
            }
        }
        "usage" => {
            let (cost_usd, cost_estimated) = match step.cost_usd {
                Some(c) => (Some(c), step.cost_estimated == Some(true)),
                None => (s.usage.cost_usd, s.usage.cost_estimated),
            };
            s.usage = Usage {
                context_percent: step.context_percent.or(s.usage.context_percent),
                tokens: step.tokens.or(s.usage.tokens),
                cost_usd,
                cost_estimated,
            };
            return;
        }
        "ping" => {
            s.pings = true;
            return;
        }
        _ => return,
    }
    if s.files.len() > MAX_FILES {
        let oldest = s
            .files
            .iter()
            .min_by_key(|(_, f)| f.last_at)
            .map(|(k, _)| k.clone());
        if let Some(k) = oldest {
            s.files.remove(&k);
        }
    }
    s.steps.push(step);
    if s.steps.len() > MAX_STEPS {
        let extra = s.steps.len() - MAX_STEPS;
        s.steps.drain(..extra);
    }
}

/// Applies `f` to the session (made if new) and tells the windows.
fn with_session(app: &AppHandle, session: &str, f: impl FnOnce(&mut Session)) {
    let snapshot = {
        let mut list = SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
        let now = now_ms();
        let mut gone = Vec::new();
        list.retain(|s| {
            let keep = s.state != "ended" || now - s.at < ENDED_TTL_MS;
            if !keep {
                gone.push(s.session.clone());
            }
            keep
        });
        let index = match list.iter().position(|s| s.session == session) {
            Some(i) => i,
            None => {
                if list.len() >= MAX_SESSIONS {
                    let drop = list
                        .iter()
                        .enumerate()
                        .min_by_key(|(_, s)| (s.state != "ended", s.at))
                        .map(|(i, _)| i)
                        .unwrap_or(0);
                    gone.push(list.remove(drop).session);
                }
                list.push(Session {
                    session: session.to_string(),
                    state: "idle".into(),
                    at: now,
                    ..Session::default()
                });
                list.len() - 1
            }
        };
        f(&mut list[index]);
        for id in gone {
            let _ = app.emit(GONE_EVENT, serde_json::json!({ "session": id }));
        }
        list[index].clone()
    };
    let _ = app.emit(EVENT, snapshot);
}

/// A session started: `cloud` for one the relay reports.
pub fn start(app: &AppHandle, session: &str, project: &str, surface: &str, cloud: bool) {
    with_session(app, session, |s| {
        s.project = project.to_string();
        s.surface = surface.to_string();
        s.cloud = cloud;
        if s.state == "ended" {
            s.state = "idle".into();
        }
        s.at = now_ms();
    });
}

pub fn end(app: &AppHandle, session: &str) {
    let known = SESSIONS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .any(|s| s.session == session);
    if known {
        with_session(app, session, |s| {
            s.state = "ended".into();
            s.doing.clear();
            s.at = now_ms();
        });
    }
}

/// Steps from a session; the project fills in for a session first heard here.
pub fn record(app: &AppHandle, session: &str, project: &str, cloud: bool, steps: Vec<Step>) {
    with_session(app, session, |s| {
        if s.project.is_empty() {
            s.project = project.to_string();
        }
        s.cloud |= cloud;
        if s.state == "ended" {
            s.state = "idle".into();
        }
        for step in steps {
            apply_step(s, step);
        }
    });
}

#[tauri::command]
pub fn activity_sessions() -> Vec<Session> {
    SESSIONS.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

fn busy(s: &Session) -> bool {
    s.state != "idle" && s.state != "ended"
}

/// Marks busy sessions whose mod stopped pinging as stopped.
fn sweep_stale(list: &mut [Session], now: i64) -> Vec<usize> {
    let mut changed = Vec::new();
    for (i, s) in list.iter_mut().enumerate() {
        if s.pings && busy(s) && now - s.at > STALE_MS {
            s.state = "idle".into();
            s.doing.clear();
            s.stopped_at = Some(now);
            changed.push(i);
        }
    }
    changed
}

/// Checks every few seconds for sessions that went quiet mid-turn.
pub fn start_sweeper(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(3));
            let changed: Vec<Session> = {
                let mut list = SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
                let idx = sweep_stale(&mut list, now_ms());
                idx.into_iter().map(|i| list[i].clone()).collect()
            };
            for s in changed {
                let _ = app.emit(EVENT, s);
            }
        }
    });
}

/// What `resume.json` holds: the home page and the prompts being written.
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Resume {
    saved_at: i64,
    sessions: Vec<Session>,
    live: Vec<crate::suggest::Live>,
}

fn resume_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    Some(app.path().app_data_dir().ok()?.join(RESUME_FILE))
}

/// Writes what the home page shows, so a restart (an update) keeps it.
pub fn save(app: &AppHandle) -> Result<(), String> {
    let path = resume_path(app).ok_or("no app data folder")?;
    let resume = Resume {
        saved_at: now_ms(),
        sessions: activity_sessions(),
        live: crate::suggest::live_snapshot(),
    };
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_vec(&resume).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Called before an update installs (the installer closes the app).
#[tauri::command]
pub fn activity_save(app: AppHandle) -> Result<(), String> {
    save(&app)
}

/// Brings back what was saved before the last restart, if it is recent.
pub fn restore(app: &AppHandle) {
    let Some(path) = resume_path(app) else { return };
    let Ok(bytes) = std::fs::read(&path) else {
        return;
    };
    let _ = std::fs::remove_file(&path);
    let Ok(resume) = serde_json::from_slice::<Resume>(&bytes) else {
        return;
    };
    let now = now_ms();
    if now - resume.saved_at > RESUME_TTL_MS {
        return;
    }
    {
        let mut list = SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
        for mut s in resume.sessions {
            if list.iter().any(|x| x.session == s.session) || now - s.at > ENDED_TTL_MS {
                continue;
            }
            // A busy one gets a fresh wait for the mod's next ping.
            s.pings = busy(&s);
            s.at = s.at.max(now);
            if list.len() < MAX_SESSIONS {
                list.push(s);
            }
        }
    }
    crate::suggest::live_restore(resume.live);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn step(kind: &str, id: &str) -> Step {
        Step {
            at: 10,
            kind: kind.into(),
            id: id.into(),
            ..Step::default()
        }
    }

    #[test]
    fn a_turn_counts_reads_edits_and_commands() {
        let mut s = Session {
            project: "/repo".into(),
            ..Session::default()
        };
        apply_step(
            &mut s,
            Step {
                phase: "start".into(),
                ..step("turn", "t1")
            },
        );
        assert_eq!(s.state, "thinking");
        apply_step(
            &mut s,
            Step {
                tool: "Read".into(),
                target: "/repo/src/a.ts".into(),
                ..step("tool", "1")
            },
        );
        assert_eq!((s.state.as_str(), s.doing.as_str()), ("read", "src/a.ts"));
        apply_step(&mut s, step("toolEnd", "1"));
        apply_step(
            &mut s,
            Step {
                tool: "Edit".into(),
                target: "/repo/src/a.ts".into(),
                ..step("tool", "2")
            },
        );
        apply_step(
            &mut s,
            Step {
                added: 3,
                removed: 1,
                ok: Some(true),
                ..step("toolEnd", "2")
            },
        );
        apply_step(
            &mut s,
            Step {
                tool: "Bash".into(),
                detail: "pnpm test --token=abcdefghijklmnopqrstuvwxyz0123456789".into(),
                ..step("tool", "3")
            },
        );
        apply_step(
            &mut s,
            Step {
                ok: Some(false),
                ..step("toolEnd", "3")
            },
        );
        let f = &s.files["src/a.ts"];
        assert_eq!((f.reads, f.edits, f.added, f.removed), (1, 1, 3, 1));
        assert_eq!(f.last, "edit");
        assert_eq!(
            (
                s.turn.tools,
                s.turn.reads,
                s.turn.edits,
                s.turn.commands,
                s.turn.failed
            ),
            (3, 1, 1, 1, 1)
        );
        assert!(
            !s.steps[4].detail.contains("abcdefghijklmnop"),
            "{}",
            s.steps[4].detail
        );
        apply_step(
            &mut s,
            Step {
                answer: "Fixed.\n\n    code stays indented\napi_key = sk-abcdefghijklmnop1234"
                    .into(),
                ..step("turn", "t1")
            },
        );
        assert_eq!(s.state, "idle");
        let answer = &s.steps.last().unwrap().answer;
        assert!(answer.contains("\n    code stays indented"), "{answer}");
        assert!(!answer.contains("sk-abcdefghijklmnop1234"), "{answer}");
    }

    #[test]
    fn subagent_turns_leave_the_main_turn_alone() {
        let mut s = Session::default();
        apply_step(
            &mut s,
            Step {
                phase: "start".into(),
                ..step("turn", "t1")
            },
        );
        apply_step(
            &mut s,
            Step {
                phase: "end".into(),
                agent: Some("a1".into()),
                ..step("turn", "t2")
            },
        );
        assert_eq!(s.state, "thinking");
        assert_eq!(s.turns, 1);
    }

    #[test]
    fn usage_updates_without_a_step() {
        let mut s = Session::default();
        apply_step(
            &mut s,
            Step {
                context_percent: Some(42.0),
                cost_usd: Some(0.5),
                ..step("usage", "")
            },
        );
        assert_eq!(s.usage.context_percent, Some(42.0));
        assert!(s.steps.is_empty());
    }

    #[test]
    fn paths_become_relative_to_the_project() {
        assert_eq!(relative("C:\\repo\\", "C:\\repo\\src\\a.rs"), "src/a.rs");
        assert_eq!(relative("/repo", "/other/a.rs"), "/other/a.rs");
        assert_eq!(relative("/repo", "src/a.rs"), "src/a.rs");
        assert_eq!(category("mcp__github__x"), "mcp");
    }

    #[test]
    fn questions_and_agent_tasks_are_kept() {
        assert_eq!(category("AskUserQuestion"), "ask");
        let mut s = Session::default();
        apply_step(
            &mut s,
            Step {
                tool: "Agent".into(),
                prompt: "Look into the cache".into(),
                ..step("tool", "a")
            },
        );
        assert_eq!(s.steps[0].category, "agent");
        assert_eq!(s.steps[0].prompt, "Look into the cache");
    }

    #[test]
    fn an_interrupted_turn_is_marked_stopped() {
        let mut s = Session::default();
        apply_step(
            &mut s,
            Step {
                phase: "start".into(),
                ..step("turn", "t1")
            },
        );
        assert_eq!(s.stopped_at, None);
        apply_step(
            &mut s,
            Step {
                phase: "end".into(),
                ok: Some(false),
                ..step("turn", "t1")
            },
        );
        assert_eq!((s.state.as_str(), s.stopped_at), ("idle", Some(10)));
        apply_step(
            &mut s,
            Step {
                phase: "start".into(),
                ..step("turn", "t2")
            },
        );
        assert_eq!(s.stopped_at, None);
    }

    #[test]
    fn a_session_that_stops_pinging_mid_turn_stops() {
        let mut s = Session {
            state: "thinking".into(),
            at: 1_000,
            ..Session::default()
        };
        let mut list = vec![s.clone()];
        // Without pings (an older mod) a long tool call is left alone.
        assert!(sweep_stale(&mut list, 1_000 + STALE_MS * 4).is_empty());
        apply_step(
            &mut s,
            Step {
                at: 2_000,
                ..step("ping", "")
            },
        );
        assert!(s.pings && s.steps.is_empty());
        let mut list = vec![s];
        assert!(sweep_stale(&mut list, 2_000 + STALE_MS - 1).is_empty());
        assert_eq!(sweep_stale(&mut list, 2_000 + STALE_MS + 1), vec![0]);
        assert_eq!(list[0].state, "idle");
        assert!(list[0].stopped_at.is_some());
    }

    #[test]
    fn an_estimated_cost_is_flagged() {
        let mut s = Session::default();
        apply_step(
            &mut s,
            Step {
                cost_usd: Some(0.25),
                cost_estimated: Some(true),
                ..step("usage", "")
            },
        );
        apply_step(
            &mut s,
            Step {
                context_percent: Some(10.0),
                ..step("usage", "")
            },
        );
        assert_eq!(
            (s.usage.cost_usd, s.usage.cost_estimated),
            (Some(0.25), true)
        );
    }
}
