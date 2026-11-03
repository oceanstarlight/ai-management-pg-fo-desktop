//! Cloud relay: Claude Code sessions in the cloud (claude.ai/code) can't reach
//! this computer's bridge folder, so a hook (`relay_hook.mjs`) sends each
//! prompt, answer and tool call to the Firebase Realtime Database
//! (`relays/{token}/events`). This app holds one streaming connection to
//! that list (server-sent events: no polling, billed by bytes, not reads),
//! takes each event and deletes it, and writes what to add to the next
//! prompt to `relays/{token}/context/{repo}` when it changes. The token is
//! the key: the rules (`firebase/database.rules.json`) let whoever holds it
//! add events and read the context, and only the owner's account reads and
//! deletes events. Needs a signed-in account.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};

use super::firebase::{self, Client, Endpoints, Error, Session, send};
use super::{Sync, account, config, now_ms};
use ureq::Agent;
use ureq::tls::{RootCerts, TlsConfig};

/// `on` while the relay is used; local to this device.
pub const PREF: &str = "cloudRelay";
/// The relay key (64 hex characters); local to this device.
const TOKEN_KEY: &str = "cloudRelayToken";
const STATUS_EVENT: &str = "relay-status";
/// How often changed contexts are written, and a stopped relay looked at.
const INTERVAL: Duration = Duration::from_secs(4);
/// A stream is opened again after this long, before its sign-in expires.
const STREAM_FOR: Duration = Duration::from_secs(50 * 60);
/// Waits after a failed stream, doubling up to the last.
const BACKOFF: [u64; 5] = [2, 5, 15, 30, 60];
/// `AIM_FIREBASE_DATABASE` overrides the Realtime Database URL.
const DATABASE_ENV: &str = "AIM_FIREBASE_DATABASE";
/// The rules' limit on the context text.
const MAX_CONTEXT: usize = 8000;

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    enabled: bool,
    token: Option<String>,
    /// `off`, `needsSignIn`, `ok` or `error`.
    state: String,
    message: Option<String>,
    /// Epoch milliseconds of the last prompt or answer received.
    last_event: Option<i64>,
}

static STATUS: Mutex<Option<Status>> = Mutex::new(None);
/// Repository key → (project it maps to, context last written for it).
static CONTEXTS: Mutex<Option<HashMap<String, (String, String)>>> = Mutex::new(None);

fn enabled(app: &AppHandle) -> bool {
    crate::prefs::get(app, PREF).as_deref() == Some("on")
}

fn valid_token(token: &str) -> bool {
    token.len() == 64
        && token
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn token(app: &AppHandle) -> Option<String> {
    crate::prefs::get(app, TOKEN_KEY).filter(|t| valid_token(t))
}

fn set_pref(app: &AppHandle, key: &str, value: Option<&str>) -> Result<(), String> {
    let prefs = app.state::<crate::prefs::Prefs>();
    let store = prefs.store().map_err(|e| e.to_string())?;
    if store.set(key, value).map_err(|e| e.to_string())? {
        crate::prefs::announce(app, key, value);
    }
    Ok(())
}

fn update_status(app: &AppHandle, f: impl FnOnce(&mut Status)) -> Status {
    let status = {
        let mut slot = STATUS.lock().unwrap_or_else(|e| e.into_inner());
        let mut status = slot.clone().unwrap_or_default();
        status.enabled = enabled(app);
        status.token = token(app);
        if !status.enabled {
            status.state = "off".into();
            status.message = None;
        }
        f(&mut status);
        if !status.enabled {
            status.state = "off".into();
        }
        *slot = Some(status.clone());
        status
    };
    let _ = app.emit(STATUS_EVENT, status.clone());
    status
}

/// The project's Realtime Database, as the console names it for a database
/// in us-central1; `AIM_FIREBASE_DATABASE` gives another one.
pub fn database_url() -> Option<String> {
    if let Ok(url) = std::env::var(DATABASE_ENV)
        && !url.trim().is_empty()
    {
        return Some(url.trim().trim_end_matches('/').to_string());
    }
    config().map(|c| format!("https://{}-default-rtdb.firebaseio.com", c.project_id))
}

/// A path under the database with the account's sign-in.
fn db_url(db: &str, path: &str, session: &Session) -> String {
    format!("{db}/{path}.json?auth={}", session.id_token)
}

/// Streams events while the relay is on, and writes changed contexts.
pub fn start(app: &AppHandle) {
    let stream_app = app.clone();
    std::thread::spawn(move || {
        let app = stream_app;
        let agent = stream_agent();
        let mut failures = 0usize;
        loop {
            let Some(token) = token(&app).filter(|_| enabled(&app)) else {
                failures = 0;
                std::thread::sleep(INTERVAL);
                continue;
            };
            match stream(&app, &agent, &token) {
                Ok(state) => {
                    failures = 0;
                    update_status(&app, |s| {
                        s.state = state.into();
                        s.message = None;
                    });
                    if state == "needsSignIn" {
                        std::thread::sleep(INTERVAL);
                    }
                }
                Err(e) => {
                    update_status(&app, |s| {
                        s.state = "error".into();
                        s.message = Some(relay_error(e));
                    });
                    let wait = BACKOFF[failures.min(BACKOFF.len() - 1)];
                    failures += 1;
                    std::thread::sleep(Duration::from_secs(wait));
                }
            }
        }
    });
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(INTERVAL);
            if let Some(token) = token(&app).filter(|_| enabled(&app)) {
                let _ = write_contexts(&app, &token);
            }
        }
    });
}

/// An agent for one long stream: no overall timeout, the body cut off after
/// `STREAM_FOR` so a silent connection never hangs on.
fn stream_agent() -> Agent {
    Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(30)))
        .timeout_recv_body(Some(STREAM_FOR))
        .tls_config(
            TlsConfig::builder()
                .root_certs(RootCerts::PlatformVerifier)
                .build(),
        )
        .http_status_as_error(false)
        .user_agent(concat!("ai-management/", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

/// The signed-in account, or `None`.
fn signed_in(app: &AppHandle) -> firebase::Result<Option<Session>> {
    let config = config().ok_or_else(|| Error::Other("Firebase is not configured".into()))?;
    let sync = app.state::<Sync>();
    let ends = Endpoints::default();
    let client = Client {
        agent: &sync.agent,
        ends: &ends,
        config: &config,
    };
    account::session(app, &client)
}

fn database() -> firebase::Result<String> {
    database_url().ok_or_else(|| Error::Other("Firebase is not configured".into()))
}

/// The relay needs only a signed-in account, so a refusal means the
/// database's rules aren't published yet, not that the account lacks sync.
fn relay_error(e: Error) -> String {
    match e {
        Error::Forbidden => crate::tr!(
            "서버가 연결을 거부했어요. Realtime Database 규칙(firebase/database.rules.json)을 게시해야 해요.",
            "The server refused. The Realtime Database rules (firebase/database.rules.json) need to be published."
        ),
        e => e.into(),
    }
}

fn check(status: u16, body: &Value) -> firebase::Result<()> {
    match status {
        200..=299 => Ok(()),
        401 => Err(Error::BadToken),
        403 => Err(Error::Forbidden),
        404 => Err(Error::Other(crate::tr!(
            "Realtime Database가 없어요. Firebase 콘솔에서 만들어 주세요 (docs/sync-setup.md).",
            "There's no Realtime Database. Create one in the Firebase console (docs/sync-setup.md)."
        ))),
        _ => Err(Error::Other(format!(
            "relay ({status}) {}",
            body["error"].as_str().unwrap_or("")
        ))),
    }
}

/// A plain request to the database (`GET`, `PUT` or `DELETE`).
fn request(
    app: &AppHandle,
    method: &str,
    url: &str,
    body: Option<Value>,
) -> firebase::Result<Value> {
    let sync = app.state::<Sync>();
    let response = match method {
        "GET" => sync.agent.get(url).call(),
        "DELETE" => sync.agent.delete(url).call(),
        _ => sync.agent.put(url).send_json(body.unwrap_or(Value::Null)),
    };
    let (status, body) = send(response)?;
    check(status, &body)?;
    Ok(body)
}

/// Collects one server-sent event from its lines.
#[derive(Default)]
struct Sse {
    event: String,
    data: String,
}

impl Sse {
    /// Feeds a line; a blank line completes an event `(name, data)`.
    fn line(&mut self, line: &str) -> Option<(String, String)> {
        let line = line.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            if self.event.is_empty() && self.data.is_empty() {
                return None;
            }
            return Some((
                std::mem::take(&mut self.event),
                std::mem::take(&mut self.data),
            ));
        }
        if let Some(v) = line.strip_prefix("event:") {
            self.event = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("data:") {
            if !self.data.is_empty() {
                self.data.push('\n');
            }
            self.data.push_str(v.trim_start());
        }
        None
    }
}

/// The events a `put` or `patch` carries: `(id, event)` for each one added.
fn events_in(name: &str, data: &str) -> Vec<(String, Value)> {
    let Ok(msg) = serde_json::from_str::<Value>(data) else {
        return Vec::new();
    };
    let path = msg["path"].as_str().unwrap_or("/").trim_matches('/');
    let body = &msg["data"];
    match (name, path) {
        ("put" | "patch", "") => body
            .as_object()
            .map(|m| {
                m.iter()
                    .filter(|(_, v)| v.is_object())
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect()
            })
            .unwrap_or_default(),
        ("put", id) if !id.contains('/') && body.is_object() => {
            vec![(id.to_string(), body.clone())]
        }
        _ => Vec::new(),
    }
}

/// One stream: open it, take each event until it ends or the sign-in is
/// revoked. `Ok("needsSignIn")` when nobody is signed in.
fn stream(app: &AppHandle, agent: &Agent, token: &str) -> firebase::Result<&'static str> {
    let Some(session) = signed_in(app)? else {
        return Ok("needsSignIn");
    };
    let db = database()?;
    let url = db_url(&db, &format!("relays/{token}/events"), &session);
    let response = agent
        .get(&url)
        .header("Accept", "text/event-stream")
        .call()
        .map_err(|e| Error::Offline(e.to_string()))?;
    let status = response.status().as_u16();
    if status >= 300 {
        let (status, body) = send(Ok(response))?;
        check(status, &body)?;
        return Ok("ok");
    }
    update_status(app, |s| {
        s.state = "ok".into();
        s.message = None;
    });
    let reader = BufReader::new(response.into_body().into_reader());
    let mut sse = Sse::default();
    for line in reader.lines() {
        let Ok(line) = line else {
            break;
        };
        let Some((name, data)) = sse.line(&line) else {
            continue;
        };
        match name.as_str() {
            "put" | "patch" => {
                let mut events = events_in(&name, &data);
                events.sort_by_key(|(_, e)| e["at"].as_i64().unwrap_or_default());
                // A batch is what queued up while the app was away: caught
                // up on quietly, the work graph drawn once at the end.
                let batch = events.len() > 1;
                if batch {
                    crate::activity::begin_catch_up(app);
                }
                let now = now_ms();
                for (id, event) in events {
                    let _ = request(
                        app,
                        "DELETE",
                        &db_url(&db, &format!("relays/{token}/events/{id}"), &session),
                        None,
                    );
                    if let Some(at) = event["at"].as_i64() {
                        update_status(app, |s| s.last_event = Some(at));
                    }
                    let fresh = event["at"].as_i64().is_some_and(|at| now - at <= FRESH_MS);
                    handle(app, &event, fresh);
                }
                if batch {
                    crate::activity::end_catch_up(app);
                }
            }
            "cancel" => return Err(Error::Forbidden),
            "auth_revoked" => break,
            _ => {}
        }
    }
    Ok("ok")
}

/// The live session id for a cloud session: `cloud-` and the safe part of its id.
fn session_id(session: &str) -> String {
    let safe: String = session
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(50)
        .collect();
    format!("cloud-{safe}")
}

/// `owner/repo` of a remote URL (`https://github.com/o/r.git`, `git@github.com:o/r`,
/// or a proxy URL ending in `/o/r`).
fn remote_slug(url: &str) -> Option<String> {
    let url = url.trim().trim_end_matches('/');
    let url = url.strip_suffix(".git").unwrap_or(url);
    let mut parts = url.rsplit(['/', ':']).filter(|p| !p.is_empty());
    let repo = parts.next()?;
    let owner = parts.next()?;
    Some(format!("{owner}/{repo}").to_lowercase())
}

/// The hook's key for a slug (`owner__repo`), as `relay_hook.mjs` makes it.
fn repo_key(slug: &str) -> String {
    slug.replacen('/', "__", 1)
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .take(200)
        .collect()
}

/// The local project with this repository as `origin`, else `owner/repo`.
fn project_for(app: &AppHandle, key: &str) -> String {
    if let Some((project, _)) = CONTEXTS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .and_then(|m| m.get(key))
    {
        return project.clone();
    }
    let mut paths: Vec<String> = crate::prefs::get(app, "recentProjects")
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_default();
    paths.extend(crate::prefs::get(app, "currentProject"));
    for path in paths {
        let Ok(out) = crate::git::run(Path::new(&path), &["remote", "get-url", "origin"]) else {
            continue;
        };
        if remote_slug(&out).is_some_and(|slug| repo_key(&slug).eq_ignore_ascii_case(key)) {
            return path;
        }
    }
    key.replacen("__", "/", 1)
}

/// An event older than this is history being caught up on, not something
/// happening now: it is shown, but nothing is suggested, extracted or docked
/// for it.
const FRESH_MS: i64 = 90 * 1000;

fn handle(app: &AppHandle, event: &Value, fresh: bool) {
    let s = |k: &str| event[k].as_str().unwrap_or_default().to_string();
    let repo = s("repo");
    if repo.is_empty() {
        return;
    }
    let project = project_for(app, &repo);
    CONTEXTS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get_or_insert_default()
        .entry(repo.clone())
        .or_insert_with(|| (project.clone(), String::new()));
    let session = session_id(&s("session"));
    let branch = s("branch");
    let at = event["at"].as_i64().unwrap_or_default();
    let step = |kind: &str| crate::activity::Step {
        at,
        kind: kind.into(),
        id: s("id"),
        tool: s("tool"),
        target: s("target"),
        detail: s("detail"),
        added: event["added"].as_u64().unwrap_or_default() as u32,
        removed: event["removed"].as_u64().unwrap_or_default() as u32,
        ok: event["ok"].as_bool(),
        agent: event["agent"].as_str().map(str::to_string),
        ..Default::default()
    };
    match s("kind").as_str() {
        "prompt" => {
            let text = s("text");
            let turn = crate::activity::Step {
                phase: "start".into(),
                detail: text.chars().take(300).collect(),
                ..step("turn")
            };
            crate::activity::record(app, &session, &project, &branch, true, vec![turn]);
            crate::suggest::cloud_prompt(app, &session, project, &text, fresh);
        }
        "answer" => {
            let turn = crate::activity::Step {
                phase: "end".into(),
                answer: s("text"),
                ..step("turn")
            };
            crate::activity::record(app, &session, &project, &branch, true, vec![turn]);
            if !fresh {
                return;
            }
            crate::decisions::apply_request(
                app,
                crate::bridge::Request::TurnAnswer {
                    session,
                    project,
                    prompt: String::new(),
                    answer: s("text"),
                },
            );
        }
        kind @ ("tool" | "toolEnd") => {
            crate::activity::record(app, &session, &project, &branch, true, vec![step(kind)]);
        }
        _ => {}
    }
}

/// What the hook adds to the next prompt: the project's decisions and what
/// the user allowed for its cloud sessions.
fn context_text(decisions: &[String], picks: &[String]) -> String {
    let mut out = String::new();
    if !decisions.is_empty() {
        out.push_str(
            "Project decisions recorded in Encela (follow them unless the user says otherwise):\n",
        );
        for line in decisions {
            out.push_str(&format!("- {line}\n"));
        }
    }
    if !picks.is_empty() {
        out.push_str(&format!(
            "The user chose these in Encela for this work; use them where they fit: {}\n",
            picks.join(", ")
        ));
    }
    out.chars().take(MAX_CONTEXT).collect()
}

fn write_contexts(app: &AppHandle, token: &str) -> firebase::Result<()> {
    let wanted: Vec<(String, String)> = {
        let decisions = crate::decisions::lines_by_project(app);
        let contexts = CONTEXTS.lock().unwrap_or_else(|e| e.into_inner());
        contexts
            .iter()
            .flatten()
            .filter_map(|(key, (project, last))| {
                let text = context_text(
                    decisions.get(project).map_or(&[][..], Vec::as_slice),
                    &crate::suggest::cloud_picks(project),
                );
                (text != *last).then(|| (key.clone(), text))
            })
            .collect()
    };
    if wanted.is_empty() {
        return Ok(());
    }
    let Some(session) = signed_in(app)? else {
        return Ok(());
    };
    let db = database()?;
    for (key, text) in wanted {
        let body = json!({ "text": text, "updatedAt": now_ms() });
        request(
            app,
            "PUT",
            &db_url(&db, &format!("relays/{token}/context/{key}"), &session),
            Some(body),
        )?;
        if let Some((_, last)) = CONTEXTS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_mut()
            .and_then(|m| m.get_mut(&key))
        {
            *last = text;
        }
    }
    Ok(())
}

fn new_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// The hook script for this Firebase project; with a token, it needs no
/// `ENCELA_RELAY` variable.
fn hook_script(token: Option<&str>) -> String {
    include_str!("relay_hook.mjs")
        .replace("__TOKEN__", token.unwrap_or(""))
        .replace("__DATABASE__", &database_url().unwrap_or_default())
}

const HOOK_FILE: &str = ".claude/hooks/encela-relay.mjs";

/// The hook events the relay listens to, and the kind each one sends.
const HOOK_EVENTS: [(&str, &str); 4] = [
    ("UserPromptSubmit", "prompt"),
    ("Stop", "answer"),
    ("PreToolUse", "tool"),
    ("PostToolUse", "toolEnd"),
];

fn hook_command(kind: &str) -> String {
    format!("node \"$CLAUDE_PROJECT_DIR/{HOOK_FILE}\" {kind}")
}

/// Adds the relay hooks to a settings.json value, keeping everything else.
fn merge_hooks(settings: &mut Value) {
    if !settings.is_object() {
        *settings = json!({});
    }
    let hooks = settings
        .as_object_mut()
        .map(|o| o.entry("hooks").or_insert_with(|| json!({})))
        .filter(|h| h.is_object());
    let Some(hooks) = hooks else {
        return;
    };
    for (event, kind) in HOOK_EVENTS {
        let list = hooks
            .as_object_mut()
            .map(|o| o.entry(event).or_insert_with(|| json!([])));
        let Some(Value::Array(list)) = list else {
            continue;
        };
        let present = list.iter().any(|group| {
            group["hooks"].as_array().is_some_and(|hs| {
                hs.iter().any(|h| {
                    h["command"]
                        .as_str()
                        .is_some_and(|c| c.contains("encela-relay"))
                })
            })
        });
        if !present {
            let mut group = json!({ "hooks": [{
                "type": "command",
                "command": hook_command(kind),
                "timeout": 10,
            }]});
            if event.ends_with("ToolUse") {
                group["matcher"] = json!("*");
            }
            list.push(group);
        }
    }
}

/// A script for the cloud environment's Setup script: installs the hook for
/// the user (every repository of that environment), with the key written in.
fn setup_script(token: &str) -> String {
    format!(
        r#"# Encela: sends this environment's Claude Code prompts, answers and tool
# calls (tool, file, command; no file contents) to the Encela app (through your Encela account) and adds what you chose there to
# the next prompt. Keep this key private; turning the connection off in
# Encela revokes it.
mkdir -p "$HOME/.claude/hooks"
cat > "$HOME/.claude/hooks/encela-relay.mjs" <<'ENCELA_HOOK'
{hook}ENCELA_HOOK
node - <<'ENCELA_SETTINGS'
const fs = require("fs");
const file = require("path").join(require("os").homedir(), ".claude", "settings.json");
let settings = {{}};
if (fs.existsSync(file)) settings = JSON.parse(fs.readFileSync(file, "utf8"));
if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {{}};
for (const [event, kind] of [["UserPromptSubmit", "prompt"], ["Stop", "answer"], ["PreToolUse", "tool"], ["PostToolUse", "toolEnd"]]) {{
  const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : (settings.hooks[event] = []);
  if (!JSON.stringify(list).includes("encela-relay")) {{
    const group = {{ hooks: [{{ type: "command", command: `node "$HOME/.claude/hooks/encela-relay.mjs" ${{kind}}`, timeout: 10 }}] }};
    if (event.endsWith("ToolUse")) group.matcher = "*";
    list.push(group);
  }}
}}
fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
ENCELA_SETTINGS
"#,
        hook = hook_script(Some(token))
    )
}

// ---------------------------------------------------------------------------
// Commands

/// The setup script to paste into the cloud environment (needs the relay on).
#[tauri::command]
pub fn relay_setup_script(app: AppHandle) -> Result<String, String> {
    match token(&app).filter(|_| enabled(&app)) {
        Some(token) => Ok(setup_script(&token)),
        None => Err(crate::tr!(
            "먼저 클라우드 연결을 켜 주세요.",
            "Turn on the cloud connection first."
        )),
    }
}

/// The database host a cloud environment's network access has to allow.
#[tauri::command]
pub fn relay_host() -> Option<String> {
    database_url().map(|url| host_of(&url))
}

fn host_of(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    rest.split('/').next().unwrap_or(rest).to_string()
}

#[tauri::command]
pub fn relay_status(app: AppHandle) -> Status {
    update_status(&app, |_| {})
}

/// Turns the relay on (making its key and its owner in the database) or off
/// (deleting the document, so the old key stops working).
#[tauri::command]
pub async fn relay_set_enabled(app: AppHandle, enabled: bool) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if enabled {
            let token = token(&app).unwrap_or_else(new_token);
            let session = signed_in(&app).map_err(relay_error)?.ok_or_else(|| {
                crate::tr!(
                    "먼저 설정 › 계정에서 로그인해 주세요.",
                    "Sign in under Settings › Account first."
                )
            })?;
            let db = database().map_err(relay_error)?;
            request(
                &app,
                "PUT",
                &db_url(&db, &format!("relays/{token}/owner"), &session),
                Some(json!(session.uid)),
            )
            .map_err(relay_error)?;
            set_pref(&app, TOKEN_KEY, Some(&token))?;
            set_pref(&app, PREF, Some("on"))?;
        } else {
            if let Some(token) = token(&app)
                && let Ok(Some(session)) = signed_in(&app)
                && let Ok(db) = database()
            {
                let _ = request(
                    &app,
                    "DELETE",
                    &db_url(&db, &format!("relays/{token}"), &session),
                    None,
                );
            }
            set_pref(&app, PREF, Some("off"))?;
            set_pref(&app, TOKEN_KEY, None)?;
            *CONTEXTS.lock().unwrap_or_else(|e| e.into_inner()) = None;
        }
        Ok(update_status(&app, |s| {
            s.state = if enabled { "ok".into() } else { "off".into() };
            s.message = None;
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Writes the hook script and adds it to the project's `.claude/settings.json`
/// (read-merge-write). Returns the files written, relative to the project.
#[tauri::command]
pub async fn relay_install_hook(project: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&project);
        if !root.is_dir() {
            return Err(crate::tr!(
                "프로젝트 폴더가 없어요.",
                "The project folder doesn't exist."
            ));
        }
        let script = root.join(HOOK_FILE);
        if let Some(dir) = script.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(&script, hook_script(None)).map_err(|e| e.to_string())?;

        let path = root.join(".claude/settings.json");
        let mut settings: Value = match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text).map_err(|e| {
                crate::tr!(
                    ".claude/settings.json을 읽지 못했어요: {e}",
                    "Couldn't read .claude/settings.json: {e}"
                )
            })?,
            Err(_) => json!({}),
        };
        merge_hooks(&mut settings);
        let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
        std::fs::write(&path, format!("{text}\n")).map_err(|e| e.to_string())?;
        Ok(vec![
            HOOK_FILE.to_string(),
            ".claude/settings.json".to_string(),
        ])
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_host_is_the_urls_authority() {
        assert_eq!(
            host_of("https://p-default-rtdb.firebaseio.com"),
            "p-default-rtdb.firebaseio.com"
        );
        assert_eq!(host_of("https://db.example.com/x/"), "db.example.com");
        assert_eq!(host_of("db.example.com"), "db.example.com");
    }

    #[test]
    fn remote_urls_become_the_hooks_key() {
        for url in [
            "https://github.com/Owner/Repo.git",
            "git@github.com:owner/repo",
            "http://local_proxy@127.0.0.1:1234/git/owner/repo/",
        ] {
            assert_eq!(repo_key(&remote_slug(url).unwrap()), "owner__repo", "{url}");
        }
        assert_eq!(remote_slug("repo"), None);
        assert_eq!(repo_key("o/my repo"), "o__my_repo");
    }

    #[test]
    fn server_sent_events_carry_the_new_events() {
        let mut sse = Sse::default();
        let mut got = Vec::new();
        for line in [
            "event: put",
            r#"data: {"path":"/","data":{"-a":{"kind":"prompt","at":2},"-b":{"kind":"tool","at":1}}}"#,
            "",
            "event: keep-alive",
            "data: null",
            "",
            "event: put",
            r#"data: {"path":"/-c","data":{"kind":"answer","at":3}}"#,
            "",
            "event: put",
            r#"data: {"path":"/-a","data":null}"#,
            "",
        ] {
            if let Some((name, data)) = sse.line(line) {
                got.extend(events_in(&name, &data).into_iter().map(|(id, _)| id));
            }
        }
        assert_eq!(got, ["-a", "-b", "-c"]);
        assert_eq!(session_id("ab/c;d"), "cloud-abcd");
    }

    #[test]
    fn context_lists_decisions_and_picks() {
        assert_eq!(context_text(&[], &[]), "");
        let text = context_text(&["Framework: Next.js".into()], &["/frontend-design".into()]);
        assert!(text.contains("- Framework: Next.js\n"));
        assert!(text.contains("/frontend-design"));
    }

    #[test]
    fn hooks_are_merged_once_and_other_keys_kept() {
        let mut settings = json!({
            "model": "opus",
            "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "echo hi" }] }] }
        });
        merge_hooks(&mut settings);
        merge_hooks(&mut settings);
        assert_eq!(settings["model"], "opus");
        assert_eq!(settings["hooks"]["Stop"].as_array().unwrap().len(), 2);
        assert_eq!(settings["hooks"]["PreToolUse"][0]["matcher"], "*");
        assert_eq!(
            settings["hooks"]["UserPromptSubmit"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(
            settings["hooks"]["UserPromptSubmit"][0]["hooks"][0]["command"]
                .as_str()
                .unwrap()
                .ends_with("encela-relay.mjs\" prompt")
        );
    }

    #[test]
    fn tokens_are_64_lowercase_hex() {
        assert!(valid_token(&new_token()));
        assert!(!valid_token("ABC"));
    }

    #[test]
    fn the_hook_script_gets_the_project() {
        let script = hook_script(None);
        assert!(!script.contains("__DATABASE__"));
        assert!(script.contains("-default-rtdb.firebaseio.com"));
        assert!(!script.contains("__TOKEN__"));
        let setup = setup_script(&"a".repeat(64));
        assert!(setup.contains(&"a".repeat(64)));
        assert!(!setup.contains("__TOKEN__"));
    }
}
