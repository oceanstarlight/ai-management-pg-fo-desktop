//! A small MCP client for the servers kept in the hub: starts one (stdio) or
//! connects to one (streamable HTTP), initializes it, lists its tools and
//! forwards tool calls. Used by the hub server (`gateway`) and by the app's
//! "check" button.
//!
//! Not supported here: the old SSE transport, WebSocket and OAuth sign-in.
//! Those servers can still be put into a project from the hub.

use std::collections::{BTreeMap, HashMap};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use ureq::Agent;
use ureq::tls::{RootCerts, TlsConfig};

use crate::mcp::Config;

type Result<T> = std::result::Result<T, String>;

/// Protocol version the hub asks for; servers may answer with an older one.
const PROTOCOL: &str = "2025-06-18";
/// The first `npx`/`uvx` run downloads the package, which can take a while.
pub const START_TIMEOUT: Duration = Duration::from_secs(120);
pub const CALL_TIMEOUT: Duration = Duration::from_secs(600);
const LIST_TIMEOUT: Duration = Duration::from_secs(60);
/// How much of a server's stderr is kept for error messages.
const STDERR_KEEP: usize = 4000;

// ---------------------------------------------------------------------------
// `${VAR}` / `${VAR:-default}`, as Claude Code expands them

/// `text` with `${VAR}` and `${VAR:-default}` filled in from `lookup`.
/// A variable that isn't set and has no default is an error.
pub fn expand(text: &str, lookup: &dyn Fn(&str) -> Option<String>) -> Result<String> {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find('}') else {
            out.push_str(&rest[start..]);
            return Ok(out);
        };
        let inner = &after[..end];
        let (name, default) = match inner.split_once(":-") {
            Some((n, d)) => (n, Some(d)),
            None => (inner, None),
        };
        let valid = !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
        if !valid {
            // Not a variable reference: keep it as written.
            out.push_str(&rest[start..start + 2 + end + 1]);
        } else {
            match lookup(name)
                .filter(|v| !v.is_empty())
                .or(default.map(str::to_string))
            {
                Some(value) => out.push_str(&value),
                None => {
                    return Err(crate::tr!(
                        "환경 변수 {name}이(가) 설정되어 있지 않아요",
                        "The environment variable {name} isn't set"
                    ));
                }
            }
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

fn env_lookup(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

/// `config` with its variables expanded and `{project}` set to `project`.
pub fn resolve(config: &Config, project: &Path) -> Result<Config> {
    let project = project.to_string_lossy();
    let fill = |s: &str| expand(&s.replace("{project}", &project), &env_lookup);
    let map = |m: &BTreeMap<String, String>| -> Result<BTreeMap<String, String>> {
        m.iter().map(|(k, v)| Ok((k.clone(), fill(v)?))).collect()
    };
    Ok(Config {
        transport: config.transport.clone(),
        command: fill(&config.command)?,
        args: config.args.iter().map(|a| fill(a)).collect::<Result<_>>()?,
        env: map(&config.env)?,
        url: fill(&config.url)?,
        headers: map(&config.headers)?,
    })
}

/// Whether the hub can start or reach this kind of server.
pub fn supported(config: &Config) -> bool {
    matches!(config.transport.as_str(), "stdio" | "http")
}

// ---------------------------------------------------------------------------
// Client

/// What a server sends on its own: the hub cares about tool list changes.
pub type OnChange = Arc<dyn Fn() + Send + Sync>;

pub struct Client {
    conn: Conn,
    next_id: AtomicI64,
    /// The server's tools as `tools/list` gave them.
    tools: Mutex<Vec<Value>>,
    /// The server said its tools changed since.
    stale: Arc<AtomicBool>,
}

enum Conn {
    Stdio(Pipe),
    Http(Http),
}

impl Client {
    /// Starts or connects to the server, initializes it and lists its tools.
    /// `cwd` is where a stdio server runs (and what it gets as its root).
    pub fn start(config: &Config, cwd: &Path, on_change: Option<OnChange>) -> Result<Arc<Client>> {
        if !supported(config) {
            return Err(crate::tr!(
                "허브는 stdio·HTTP 서버만 띄울 수 있어요 ({}). 이 서버는 프로젝트에 넣어서 쓰세요",
                "The hub can only run stdio and HTTP servers ({}). Put this one into a project instead",
                config.transport
            ));
        }
        let config = resolve(config, cwd)?;
        let stale = Arc::new(AtomicBool::new(false));
        let mark = stale.clone();
        let changed: OnChange = Arc::new(move || {
            mark.store(true, Ordering::Relaxed);
            if let Some(f) = &on_change {
                f();
            }
        });
        let conn = match config.transport.as_str() {
            "stdio" => Conn::Stdio(Pipe::spawn(&config, cwd, Some(changed))?),
            _ => Conn::Http(Http::new(&config)),
        };
        let client = Arc::new(Client {
            conn,
            next_id: AtomicI64::new(1),
            tools: Mutex::new(Vec::new()),
            stale,
        });
        client.initialize()?;
        client.refresh_tools()?;
        Ok(client)
    }

    fn initialize(&self) -> Result<()> {
        let params = json!({
            "protocolVersion": PROTOCOL,
            "capabilities": { "roots": { "listChanged": false } },
            "clientInfo": { "name": "encela-hub", "version": env!("CARGO_PKG_VERSION") },
        });
        let reply = self.request("initialize", params, START_TIMEOUT)?;
        if let Conn::Http(http) = &self.conn
            && let Some(v) = reply["protocolVersion"].as_str()
        {
            *http.version.lock().unwrap() = Some(v.to_string());
        }
        self.notify("notifications/initialized", json!({}))
    }

    /// Lists the server's tools again (all pages).
    pub fn refresh_tools(&self) -> Result<Vec<Value>> {
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..50 {
            let params = match &cursor {
                Some(c) => json!({ "cursor": c }),
                None => json!({}),
            };
            let page = self.request("tools/list", params, LIST_TIMEOUT)?;
            if let Some(list) = page["tools"].as_array() {
                tools.extend(list.iter().cloned());
            }
            cursor = page["nextCursor"]
                .as_str()
                .filter(|c| !c.is_empty())
                .map(str::to_string);
            if cursor.is_none() {
                break;
            }
        }
        *self.tools.lock().unwrap() = tools.clone();
        Ok(tools)
    }

    pub fn tools(&self) -> Vec<Value> {
        self.tools.lock().unwrap().clone()
    }

    /// The tools, read again first if the server said they changed.
    pub fn fresh_tools(&self) -> Vec<Value> {
        if self.stale.swap(false, Ordering::Relaxed) {
            let _ = self.refresh_tools();
        }
        self.tools()
    }

    /// Calls one of the server's tools; its `CallToolResult`.
    pub fn call(&self, tool: &str, arguments: Value) -> Result<Value> {
        let arguments = if arguments.is_null() {
            json!({})
        } else {
            arguments
        };
        self.request(
            "tools/call",
            json!({ "name": tool, "arguments": arguments }),
            CALL_TIMEOUT,
        )
    }

    fn request(&self, method: &str, params: Value, timeout: Duration) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let message = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        let reply = match &self.conn {
            Conn::Stdio(s) => s.request(id, &message, timeout)?,
            Conn::Http(h) => h.request(id, &message, timeout)?,
        };
        if let Some(err) = reply.get("error") {
            let text = err["message"].as_str().unwrap_or("error");
            return Err(crate::tr!(
                "서버가 오류를 돌려줬어요: {text}",
                "The server returned an error: {text}"
            ));
        }
        Ok(reply["result"].clone())
    }

    fn notify(&self, method: &str, params: Value) -> Result<()> {
        let message = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        match &self.conn {
            Conn::Stdio(s) => s.send(&message),
            Conn::Http(h) => h.notify(&message),
        }
    }

    /// Stops a stdio server (an HTTP session just ends with the client).
    pub fn close(&self) {
        if let Conn::Stdio(s) = &self.conn {
            s.kill();
        }
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        self.close();
    }
}

// ---------------------------------------------------------------------------
// stdio

type Pending = Arc<Mutex<Option<HashMap<i64, Sender<Value>>>>>;

struct Pipe {
    child: Mutex<Child>,
    stdin: Arc<Mutex<ChildStdin>>,
    /// `None` once the server's output has ended.
    pending: Pending,
    stderr: Arc<Mutex<String>>,
}

/// The program to run: on Windows, `npx` is `npx.cmd`, which `Command`
/// doesn't find on its own.
#[cfg(windows)]
fn program(command: &str) -> std::path::PathBuf {
    let path = Path::new(command);
    if path.extension().is_some() || path.components().count() > 1 {
        return path.to_path_buf();
    }
    let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
    for dir in crate::tools::cli::path_dirs() {
        for ext in exts.split(';').filter(|e| !e.is_empty()) {
            let candidate = dir.join(format!("{command}{}", ext.to_ascii_lowercase()));
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    path.to_path_buf()
}

#[cfg(not(windows))]
fn program(command: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(command)
}

impl Pipe {
    fn spawn(config: &Config, cwd: &Path, on_change: Option<OnChange>) -> Result<Pipe> {
        let mut cmd = Command::new(program(config.command.trim()));
        cmd.args(&config.args)
            .envs(&config.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if cwd.is_dir() {
            cmd.current_dir(cwd);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW: the app has no console, so each server would get one.
            cmd.creation_flags(0x0800_0000);
        }
        let mut child = cmd.spawn().map_err(|e| {
            crate::tr!(
                "{}을(를) 실행하지 못했어요: {e}",
                "Couldn't run {}: {e}",
                config.command
            )
        })?;
        let stdin = Arc::new(Mutex::new(child.stdin.take().ok_or("no stdin")?));
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr_pipe = child.stderr.take().ok_or("no stderr")?;
        let pending: Pending = Arc::new(Mutex::new(Some(HashMap::new())));
        let stderr = Arc::new(Mutex::new(String::new()));

        // stderr: keep the end of it for error messages, and keep the pipe drained.
        let keep = stderr.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stderr_pipe);
            let mut buf = [0u8; 2048];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let mut text = keep.lock().unwrap();
                text.push_str(&String::from_utf8_lossy(&buf[..n]));
                if text.len() > STDERR_KEEP * 2 {
                    let cut = text.len() - STDERR_KEEP;
                    let cut = (cut..text.len())
                        .find(|i| text.is_char_boundary(*i))
                        .unwrap_or(text.len());
                    text.drain(..cut);
                }
            }
        });

        // stdout: replies go to whoever waits on them; the server's own
        // requests get an answer here.
        let (waiting, writer) = (pending.clone(), stdin.clone());
        let root = file_uri(cwd);
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let Ok(message) = serde_json::from_str::<Value>(line.trim()) else {
                    continue;
                };
                let messages = match message {
                    Value::Array(batch) => batch,
                    m => vec![m],
                };
                for m in messages {
                    on_message(&m, &waiting, &writer, &root, on_change.as_ref());
                }
            }
            // Output ended: wake everyone still waiting.
            waiting.lock().unwrap().take();
        });

        Ok(Pipe {
            child: Mutex::new(child),
            stdin,
            pending,
            stderr,
        })
    }

    fn send(&self, message: &Value) -> Result<()> {
        let mut stdin = self.stdin.lock().unwrap();
        writeln!(stdin, "{message}")
            .and_then(|()| stdin.flush())
            .map_err(|_| self.ended())
    }

    fn request(&self, id: i64, message: &Value, timeout: Duration) -> Result<Value> {
        let (tx, rx) = mpsc::channel();
        match self.pending.lock().unwrap().as_mut() {
            Some(map) => map.insert(id, tx),
            None => return Err(self.ended()),
        };
        if let Err(e) = self.send(message) {
            self.forget(id);
            return Err(e);
        }
        match rx.recv_timeout(timeout) {
            Ok(reply) => Ok(reply),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.forget(id);
                let _ = self.send(&json!({
                    "jsonrpc": "2.0",
                    "method": "notifications/cancelled",
                    "params": { "requestId": id, "reason": "timeout" },
                }));
                Err(crate::tr!(
                    "서버가 {}초 안에 답하지 않았어요",
                    "The server didn't answer within {} seconds",
                    timeout.as_secs()
                ))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(self.ended()),
        }
    }

    fn forget(&self, id: i64) {
        if let Some(map) = self.pending.lock().unwrap().as_mut() {
            map.remove(&id);
        }
    }

    /// Why the server can't be talked to: it exited (with what it said).
    fn ended(&self) -> String {
        // Give a server that is exiting a moment, so its last words are read.
        let mut status = None;
        for _ in 0..20 {
            status = self.child.lock().unwrap().try_wait().ok().flatten();
            if status.is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        std::thread::sleep(Duration::from_millis(100));
        let code = status.and_then(|s| s.code());
        let tail = self.stderr.lock().unwrap().trim().to_string();
        let tail: String = {
            let chars: Vec<char> = tail.chars().collect();
            chars[chars.len().saturating_sub(800)..].iter().collect()
        };
        let head = match code {
            Some(code) => crate::tr!(
                "서버가 종료됐어요 (종료 코드 {code})",
                "The server exited (code {code})"
            ),
            None => crate::tr!(
                "서버와 연결이 끊겼어요",
                "Lost the connection to the server"
            ),
        };
        if tail.is_empty() {
            head
        } else {
            format!("{head}\n{tail}")
        }
    }

    fn kill(&self) {
        let mut child = self.child.lock().unwrap();
        if child.try_wait().ok().flatten().is_none() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn on_message(
    m: &Value,
    waiting: &Pending,
    writer: &Arc<Mutex<ChildStdin>>,
    root: &str,
    on_change: Option<&OnChange>,
) {
    let method = m["method"].as_str();
    match (m.get("id"), method) {
        // A reply to one of ours.
        (Some(id), None) => {
            if let Some(id) = id.as_i64()
                && let Some(map) = waiting.lock().unwrap().as_mut()
                && let Some(tx) = map.remove(&id)
            {
                let _ = tx.send(m.clone());
            }
        }
        // The server asks something.
        (Some(id), Some(method)) => {
            let reply = match method {
                "ping" => json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
                "roots/list" => json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": { "roots": [{ "uri": root, "name": "project" }] },
                }),
                _ => json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32601, "message": format!("Not supported by encela-hub: {method}") },
                }),
            };
            let mut stdin = writer.lock().unwrap();
            let _ = writeln!(stdin, "{reply}").and_then(|()| stdin.flush());
        }
        (None, Some("notifications/tools/list_changed")) => {
            if let Some(f) = on_change {
                f();
            }
        }
        _ => {}
    }
}

fn file_uri(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    if text.starts_with('/') {
        format!("file://{text}")
    } else {
        format!("file:///{text}")
    }
}

// ---------------------------------------------------------------------------
// Streamable HTTP

struct Http {
    agent: Agent,
    url: String,
    headers: BTreeMap<String, String>,
    session: Mutex<Option<String>>,
    version: Mutex<Option<String>>,
}

impl Http {
    fn new(config: &Config) -> Http {
        let agent = Agent::config_builder()
            .timeout_global(Some(CALL_TIMEOUT))
            .http_status_as_error(false)
            .tls_config(
                TlsConfig::builder()
                    .root_certs(RootCerts::PlatformVerifier)
                    .build(),
            )
            .user_agent(concat!("encela-hub/", env!("CARGO_PKG_VERSION")))
            .build()
            .into();
        Http {
            agent,
            url: config.url.trim().to_string(),
            headers: config.headers.clone(),
            session: Mutex::new(None),
            version: Mutex::new(None),
        }
    }

    fn post(&self, message: &Value) -> Result<ureq::http::Response<ureq::Body>> {
        let mut req = self
            .agent
            .post(&self.url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream");
        for (k, v) in &self.headers {
            req = req.header(k.as_str(), v.as_str());
        }
        if let Some(s) = self.session.lock().unwrap().as_deref() {
            req = req.header("Mcp-Session-Id", s);
        }
        if let Some(v) = self.version.lock().unwrap().as_deref() {
            req = req.header("MCP-Protocol-Version", v);
        }
        let res = req.send(message.to_string()).map_err(|e| {
            crate::tr!(
                "서버에 연결하지 못했어요: {e}",
                "Couldn't reach the server: {e}"
            )
        })?;
        if let Some(s) = res
            .headers()
            .get("mcp-session-id")
            .and_then(|v| v.to_str().ok())
        {
            *self.session.lock().unwrap() = Some(s.to_string());
        }
        match res.status().as_u16() {
            200..=299 => Ok(res),
            401 | 403 => Err(crate::tr!(
                "로그인이 필요한 서버예요. 허브는 OAuth 로그인을 하지 못해요: 헤더에 토큰(${{변수}})을 넣거나 프로젝트에 넣어서 /mcp로 로그인하세요",
                "This server needs a sign-in. The hub can't do OAuth: put a token (${{VAR}}) in a header, or put the server into a project and sign in with /mcp"
            )),
            code => Err(crate::tr!(
                "서버가 HTTP {code}을(를) 돌려줬어요",
                "The server returned HTTP {code}"
            )),
        }
    }

    fn request(&self, id: i64, message: &Value, _timeout: Duration) -> Result<Value> {
        let mut res = self.post(message)?;
        let sse = res
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with("text/event-stream"));
        let body = res.body_mut().with_config().limit(32 * 1024 * 1024);
        if sse {
            // Events until the one that answers `id`.
            let reader = BufReader::new(body.reader());
            let mut data = String::new();
            for line in reader.lines() {
                let line = line.map_err(|e| e.to_string())?;
                if let Some(rest) = line.strip_prefix("data:") {
                    data.push_str(rest.trim_start());
                    data.push('\n');
                } else if line.is_empty() && !data.is_empty() {
                    if let Some(reply) = find_reply(&data, id) {
                        return Ok(reply);
                    }
                    data.clear();
                }
            }
            find_reply(&data, id).ok_or_else(|| {
                crate::tr!(
                    "서버가 답 없이 끊었어요",
                    "The server ended without an answer"
                )
            })
        } else {
            let text = body.read_to_string().map_err(|e| e.to_string())?;
            find_reply(&text, id).ok_or_else(|| {
                crate::tr!(
                    "서버의 답을 읽지 못했어요",
                    "Couldn't read the server's answer"
                )
            })
        }
    }

    fn notify(&self, message: &Value) -> Result<()> {
        self.post(message).map(drop)
    }
}

/// The reply with `id` in `text` (one message or a batch).
fn find_reply(text: &str, id: i64) -> Option<Value> {
    let value: Value = serde_json::from_str(text.trim()).ok()?;
    let matches = |m: &Value| m["id"].as_i64() == Some(id) && m.get("method").is_none();
    match value {
        Value::Array(batch) => batch.into_iter().find(matches),
        m if matches(&m) => Some(m),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lookup(name: &str) -> Option<String> {
        match name {
            "TOKEN" => Some("abc".into()),
            "EMPTY" => Some(String::new()),
            _ => None,
        }
    }

    #[test]
    fn variables_expand_like_claude_code() {
        assert_eq!(expand("Bearer ${TOKEN}", &lookup).unwrap(), "Bearer abc");
        assert_eq!(expand("${NOPE:-x}/${TOKEN}", &lookup).unwrap(), "x/abc");
        assert_eq!(expand("${EMPTY:-d}", &lookup).unwrap(), "d");
        assert_eq!(
            expand("$TOKEN ${not valid}", &lookup).unwrap(),
            "$TOKEN ${not valid}"
        );
        assert_eq!(expand("open ${TOKEN", &lookup).unwrap(), "open ${TOKEN");
        assert!(expand("${NOPE}", &lookup).unwrap_err().contains("NOPE"));
    }

    #[test]
    fn replies_are_found_in_batches_and_single_messages() {
        let one = r#"{"jsonrpc":"2.0","id":3,"result":{"ok":true}}"#;
        assert_eq!(find_reply(one, 3).unwrap()["result"]["ok"], true);
        assert!(find_reply(one, 4).is_none());
        let batch = r#"[{"jsonrpc":"2.0","method":"x"},{"jsonrpc":"2.0","id":5,"result":{}}]"#;
        assert!(find_reply(batch, 5).is_some());
    }

    #[test]
    fn old_sse_and_websocket_servers_are_not_started() {
        let config = Config {
            transport: "sse".into(),
            url: "https://example.invalid/sse".into(),
            ..Config::default()
        };
        assert!(!supported(&config));
        assert!(Client::start(&config, Path::new("."), None).is_err());
    }

    /// A tiny stdio MCP server written as a shell script.
    #[cfg(unix)]
    #[test]
    fn a_stdio_server_is_started_listed_and_called() {
        let script = r#"
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"t","version":"1"}}}\n' "$id" ;;
    *'"roots/list"'*) ;;
    *'"tools/list"'*) printf '{"jsonrpc":"2.0","id":99,"method":"roots/list"}\n{"jsonrpc":"2.0","id":%s,"result":{"tools":[{"name":"echo","description":"Echo","inputSchema":{"type":"object"}}]}}\n' "$id" ;;
    *'"tools/call"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"hi"}]}}\n' "$id" ;;
  esac
done
"#;
        let config = Config {
            transport: "stdio".into(),
            command: "sh".into(),
            args: vec!["-c".into(), script.into()],
            ..Config::default()
        };
        let client = Client::start(&config, &std::env::temp_dir(), None).unwrap();
        let tools = client.tools();
        assert_eq!(tools[0]["name"], "echo");
        let result = client.call("echo", Value::Null).unwrap();
        assert_eq!(result["content"][0]["text"], "hi");
        client.close();
        assert!(client.call("echo", Value::Null).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_server_that_exits_reports_what_it_said() {
        let config = Config {
            transport: "stdio".into(),
            command: "sh".into(),
            args: vec!["-c".into(), "echo missing API key >&2; exit 3".into()],
            ..Config::default()
        };
        let err = Client::start(&config, &std::env::temp_dir(), None)
            .err()
            .unwrap();
        assert!(err.contains("missing API key"), "{err}");
    }
}
