//! Cloud relay: Claude Code sessions in the cloud (claude.ai/code) can't reach
//! this computer's bridge folder, so a hook in the repository
//! (`relay_hook.mjs`) sends each prompt and answer to Firestore
//! (`relays/{token}/events`), this app picks them up and deletes them, and the
//! hook reads back what to add to the next prompt
//! (`relays/{token}/context/{repo}`). The token is the key: the hook gets it
//! from the cloud environment's `ENCELA_RELAY` variable, the rules let whoever
//! holds it write events and read the context, and only the owner's account
//! reads events. Needs the sync account (allow-listed).

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};

use super::firebase::{self, Client, Endpoints, Error, Session, send};
use super::{Sync, account, config, now_ms};

/// `on` while the relay is used; local to this device.
pub const PREF: &str = "cloudRelay";
/// The relay key (64 hex characters); local to this device.
const TOKEN_KEY: &str = "cloudRelayToken";
const STATUS_EVENT: &str = "relay-status";
const INTERVAL: Duration = Duration::from_secs(4);
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

/// Polls for events while the relay is on.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(INTERVAL);
            if !enabled(&app) {
                continue;
            }
            let Some(token) = token(&app) else {
                continue;
            };
            let result = tick(&app, &token);
            update_status(&app, |s| match result {
                Ok(state) => {
                    s.state = state.into();
                    s.message = None;
                }
                Err(e) => {
                    s.state = "error".into();
                    s.message = Some(relay_error(e));
                }
            });
        }
    });
}

/// Runs `f` with a client and the signed-in account; `None` when nobody is signed in.
fn with_session<T>(
    app: &AppHandle,
    f: impl FnOnce(&Client, &Session) -> firebase::Result<T>,
) -> firebase::Result<Option<T>> {
    let config = config().ok_or_else(|| Error::Other("Firebase is not configured".into()))?;
    let sync = app.state::<Sync>();
    let ends = Endpoints::default();
    let client = Client {
        agent: &sync.agent,
        ends: &ends,
        config: &config,
    };
    match account::session(app, &client)? {
        Some(session) => f(&client, &session).map(Some),
        None => Ok(None),
    }
}

/// The relay needs only a signed-in account, so a refusal means the server's
/// rules don't have it yet, not that the account lacks sync.
fn relay_error(e: Error) -> String {
    match e {
        Error::Forbidden => crate::tr!(
            "서버가 연결을 거부했어요. 앱 개발자가 최신 Firestore 규칙(firebase/firestore.rules)을 게시해야 해요.",
            "The server refused. The latest Firestore rules (firebase/firestore.rules) need to be published."
        ),
        e => e.into(),
    }
}

fn check(status: u16, body: &Value) -> firebase::Result<()> {
    match status {
        200..=299 => Ok(()),
        401 => Err(Error::BadToken),
        403 => Err(Error::Forbidden),
        _ => Err(Error::Other(format!(
            "relay ({status}) {}",
            body["error"]["message"].as_str().unwrap_or("")
        ))),
    }
}

fn request(
    client: &Client,
    session: &Session,
    method: &str,
    url: &str,
    body: Option<Value>,
) -> firebase::Result<Value> {
    let auth = Client::bearer(session);
    let response = match (method, body) {
        ("GET", _) => client.agent.get(url).header("Authorization", &auth).call(),
        ("DELETE", _) => client
            .agent
            .delete(url)
            .header("Authorization", &auth)
            .call(),
        (_, body) => client
            .agent
            .patch(url)
            .header("Authorization", &auth)
            .send_json(body.unwrap_or(Value::Null)),
    };
    let (status, body) = send(response)?;
    check(status, &body)?;
    Ok(body)
}

/// One prompt or answer from a cloud session.
#[derive(Debug, PartialEq)]
struct Event {
    /// The Firestore document name, for deleting it.
    name: String,
    kind: String,
    session: String,
    repo: String,
    text: String,
    at: i64,
}

fn parse_event(doc: &Value) -> Option<Event> {
    let f = &doc["fields"];
    let s = |k: &str| f[k]["stringValue"].as_str().unwrap_or_default().to_string();
    Some(Event {
        name: doc["name"].as_str()?.to_string(),
        kind: s("kind"),
        session: s("session"),
        repo: s("repo"),
        text: s("text"),
        at: f["at"]["integerValue"]
            .as_str()
            .and_then(|v| v.parse().ok())
            .unwrap_or_default(),
    })
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

fn handle(app: &AppHandle, event: Event) {
    if event.repo.is_empty() {
        return;
    }
    let project = project_for(app, &event.repo);
    CONTEXTS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get_or_insert_default()
        .entry(event.repo.clone())
        .or_insert_with(|| (project.clone(), String::new()));
    let session = session_id(&event.session);
    match event.kind.as_str() {
        "prompt" => crate::suggest::cloud_prompt(app, &session, project, &event.text),
        "answer" => crate::decisions::apply_request(
            app,
            crate::bridge::Request::TurnAnswer {
                session,
                project,
                prompt: String::new(),
                answer: event.text,
            },
        ),
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

/// One round: take the waiting events, then refresh changed contexts.
fn tick(app: &AppHandle, token: &str) -> firebase::Result<&'static str> {
    let result = with_session(app, |client, session| {
        let base = format!("{}/relays/{token}", client.documents());
        let body = request(
            client,
            session,
            "GET",
            &format!("{base}/events?pageSize=50"),
            None,
        )?;
        let mut events: Vec<Event> = body["documents"]
            .as_array()
            .map(|docs| docs.iter().filter_map(parse_event).collect())
            .unwrap_or_default();
        events.sort_by_key(|e| e.at);
        for event in &events {
            let url = format!("{}/v1/{}", client.ends.firestore, event.name);
            request(client, session, "DELETE", &url, None)?;
        }
        Ok((base, events))
    })?;
    let Some((base, events)) = result else {
        return Ok("needsSignIn");
    };
    if let Some(last) = events.iter().map(|e| e.at).max() {
        update_status(app, |s| s.last_event = Some(last));
    }
    for event in events {
        handle(app, event);
    }
    write_contexts(app, &base)?;
    Ok("ok")
}

fn write_contexts(app: &AppHandle, base: &str) -> firebase::Result<()> {
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
    for (key, text) in wanted {
        with_session(app, |client, session| {
            let body = json!({ "fields": {
                "text": { "stringValue": text },
                "updatedAt": { "integerValue": now_ms().to_string() },
            }});
            request(
                client,
                session,
                "PATCH",
                &format!("{base}/context/{key}"),
                Some(body),
            )
        })?;
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
    let config = config();
    include_str!("relay_hook.mjs")
        .replace("__TOKEN__", token.unwrap_or(""))
        .replace(
            "__PROJECT__",
            config.as_ref().map_or("", |c| c.project_id.as_str()),
        )
        .replace(
            "__API_KEY__",
            config.as_ref().map_or("", |c| c.api_key.as_str()),
        )
}

const HOOK_FILE: &str = ".claude/hooks/encela-relay.mjs";

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
    for (event, kind) in [("UserPromptSubmit", "prompt"), ("Stop", "answer")] {
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
            list.push(json!({ "hooks": [{
                "type": "command",
                "command": hook_command(kind),
                "timeout": 10,
            }]}));
        }
    }
}

/// A script for the cloud environment's Setup script: installs the hook for
/// the user (every repository of that environment), with the key written in.
fn setup_script(token: &str) -> String {
    format!(
        r#"# Encela: sends this environment's Claude Code prompts and answers to the
# Encela app (through your Encela account) and adds what you chose there to
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
for (const [event, kind] of [["UserPromptSubmit", "prompt"], ["Stop", "answer"]]) {{
  const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : (settings.hooks[event] = []);
  if (!JSON.stringify(list).includes("encela-relay")) {{
    list.push({{ hooks: [{{ type: "command", command: `node "$HOME/.claude/hooks/encela-relay.mjs" ${{kind}}`, timeout: 10 }}] }});
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

#[tauri::command]
pub fn relay_status(app: AppHandle) -> Status {
    update_status(&app, |_| {})
}

/// Turns the relay on (making its key and Firestore document) or off
/// (deleting the document, so the old key stops working).
#[tauri::command]
pub async fn relay_set_enabled(app: AppHandle, enabled: bool) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if enabled {
            let token = token(&app).unwrap_or_else(new_token);
            let created = with_session(&app, |client, session| {
                let url = format!("{}/relays/{token}", client.documents());
                let body = json!({ "fields": {
                    "uid": { "stringValue": session.uid },
                    "updatedAt": { "integerValue": now_ms().to_string() },
                }});
                request(client, session, "PATCH", &url, Some(body))
            })
            .map_err(relay_error)?;
            if created.is_none() {
                return Err(crate::tr!(
                    "먼저 설정 › 계정에서 로그인해 주세요.",
                    "Sign in under Settings › Account first."
                ));
            }
            set_pref(&app, TOKEN_KEY, Some(&token))?;
            set_pref(&app, PREF, Some("on"))?;
        } else {
            if let Some(token) = token(&app) {
                let _ = with_session(&app, |client, session| {
                    let url = format!("{}/relays/{token}", client.documents());
                    request(client, session, "DELETE", &url, None)
                });
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
    fn events_are_read_from_firestore_fields() {
        let doc = json!({
            "name": "projects/p/databases/(default)/documents/relays/t/events/e1",
            "fields": {
                "kind": { "stringValue": "prompt" },
                "session": { "stringValue": "abc" },
                "repo": { "stringValue": "o__r" },
                "text": { "stringValue": "make a memo site" },
                "at": { "integerValue": "42" },
            }
        });
        let e = parse_event(&doc).unwrap();
        assert_eq!(
            (e.kind.as_str(), e.text.as_str(), e.at),
            ("prompt", "make a memo site", 42)
        );
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
        assert!(!script.contains("__PROJECT__") && !script.contains("__API_KEY__"));
        assert!(!script.contains("__TOKEN__"));
        let setup = setup_script(&"a".repeat(64));
        assert!(setup.contains(&"a".repeat(64)));
        assert!(!setup.contains("__TOKEN__"));
    }
}
