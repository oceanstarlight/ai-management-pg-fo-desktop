//! `encela-hub`: one MCP server in Claude Code for every server kept in the
//! hub. `<app> mcp hub [--data-dir <dir>]`, stdio.
//!
//! Kept servers aren't started until Claude asks for one
//! (`hub_open_server`). Their tools are then listed as `<server>__<tool>`
//! (with `notifications/tools/list_changed`) and passed through; `hub_call`
//! reaches them too, for clients that don't refresh their tool list.
//! Started servers stop when Claude Code closes the hub (stdin ends).

use std::collections::BTreeMap;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::client::{self, Client};
use super::{Combo, Entry, ModuleKind, load_all};

const PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

/// Claude Code names a tool `mcp__encela-hub__<name>` and the API allows 64
/// characters, which leaves this much for `<server>__<tool>`.
const MAX_TOOL_NAME: usize = 64 - "mcp__encela-hub__".len();

type Out = Arc<Mutex<std::io::Stdout>>;

/// Runs the hub until stdin closes; the process exit code.
pub fn run(data_dir: PathBuf) -> i32 {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let hub = Arc::new(Hub::new(
        data_dir,
        cwd,
        Arc::new(Mutex::new(std::io::stdout())),
    ));
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let messages = match serde_json::from_str::<Value>(&line) {
            Ok(Value::Array(batch)) => batch,
            Ok(m) => vec![m],
            Err(_) => {
                hub.send(&error(Value::Null, -32700, "Parse error"));
                continue;
            }
        };
        for message in messages {
            // Tool calls can take long: each runs on its own thread.
            if message["method"] == "tools/call" {
                let hub = hub.clone();
                std::thread::spawn(move || {
                    if let Some(reply) = hub.handle(&message) {
                        hub.send(&reply);
                    }
                    hub.flush_list_changed();
                });
            } else if let Some(reply) = hub.handle(&message) {
                hub.send(&reply);
            }
        }
    }
    hub.close_all();
    0
}

/// A tool of a started server, under the name Claude sees.
struct Route {
    server: String,
    tool: String,
}

pub struct Hub {
    data_dir: PathBuf,
    cwd: PathBuf,
    out: Out,
    /// Started servers by name.
    open: Mutex<BTreeMap<String, Arc<Client>>>,
    /// One server starts at a time (a second ask for it waits and reuses it).
    starting: Mutex<()>,
    /// Set when the tool list changed and the client hasn't been told.
    changed: Mutex<bool>,
}

impl Hub {
    pub fn new(data_dir: PathBuf, cwd: PathBuf, out: Out) -> Hub {
        Hub {
            data_dir,
            cwd,
            out,
            open: Mutex::new(BTreeMap::new()),
            starting: Mutex::new(()),
            changed: Mutex::new(false),
        }
    }

    fn send(&self, message: &Value) {
        let mut out = self.out.lock().unwrap();
        let _ = writeln!(out, "{message}").and_then(|()| out.flush());
    }

    fn flush_list_changed(&self) {
        let changed = std::mem::take(&mut *self.changed.lock().unwrap());
        if changed {
            self.send(&json!({ "jsonrpc": "2.0", "method": "notifications/tools/list_changed" }));
        }
    }

    fn close_all(&self) {
        for (_, c) in std::mem::take(&mut *self.open.lock().unwrap()) {
            c.close();
        }
    }

    /// Modules offered through the hub.
    fn entries(&self) -> Vec<Entry> {
        self.everything().0
    }

    /// Modules offered through the hub, and the combinations of them.
    fn everything(&self) -> (Vec<Entry>, Vec<Combo>) {
        let hub = load_all(&self.data_dir).unwrap_or_default();
        let modules: Vec<Entry> = hub.modules.into_iter().filter(|e| e.in_hub).collect();
        let combos = hub
            .combos
            .into_iter()
            .filter(|c| {
                c.members
                    .iter()
                    .all(|m| modules.iter().any(|e| e.name == m.module))
            })
            .collect();
        (modules, combos)
    }

    /// The reply to a request; notifications and responses get none.
    pub fn handle(&self, message: &Value) -> Option<Value> {
        let id = message.get("id")?.clone();
        let Some(method) = message["method"].as_str() else {
            // A response to something we never ask.
            return None;
        };
        let params = &message["params"];
        let result = match method {
            "initialize" => Ok(self.initialize(params)),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({ "tools": self.tool_list() })),
            "tools/call" => Ok(self.call(
                params["name"].as_str().unwrap_or_default(),
                &params["arguments"],
            )),
            _ => Err((-32601, format!("Method not found: {method}"))),
        };
        Some(match result {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err((code, text)) => error(id, code, &text),
        })
    }

    fn initialize(&self, params: &Value) -> Value {
        let asked = params["protocolVersion"].as_str().unwrap_or_default();
        let version = PROTOCOL_VERSIONS
            .iter()
            .find(|v| **v == asked)
            .unwrap_or(&PROTOCOL_VERSIONS[0]);
        let (modules, combos) = self.everything();
        json!({
            "protocolVersion": version,
            "capabilities": { "tools": { "listChanged": true } },
            "serverInfo": { "name": super::HUB_NAME, "version": env!("CARGO_PKG_VERSION") },
            "instructions": instructions(&modules, &combos),
        })
    }

    // -----------------------------------------------------------------------
    // Tools

    fn tool_list(&self) -> Vec<Value> {
        let mut tools = own_tools();
        let open = self.open.lock().unwrap().clone();
        for (server, client) in &open {
            for t in client.fresh_tools() {
                let mut t = t.clone();
                let name = t["name"].as_str().unwrap_or_default().to_string();
                let description = t["description"].as_str().unwrap_or_default().to_string();
                t["name"] = exposed(server, &name).into();
                t["description"] = format!("[{server}] {description}").into();
                tools.push(t);
            }
        }
        tools
    }

    /// Where an exposed `<server>__<tool>` name goes.
    fn route(&self, name: &str) -> Option<Route> {
        let open = self.open.lock().unwrap();
        for (server, client) in open.iter() {
            for t in client.tools() {
                let tool = t["name"].as_str().unwrap_or_default();
                if exposed(server, tool) == name {
                    return Some(Route {
                        server: server.clone(),
                        tool: tool.to_string(),
                    });
                }
            }
        }
        None
    }

    /// A `CallToolResult`; failures are tool errors Claude can read.
    fn call(&self, name: &str, args: &Value) -> Value {
        let result = match name {
            "hub_list_servers" => self.list_servers(args["query"].as_str().unwrap_or_default()),
            "hub_open_server" => self.open_server(args["name"].as_str().unwrap_or_default()),
            "hub_list_tools" => self.list_tools(
                args["server"].as_str().unwrap_or_default(),
                args["tools"].as_array(),
            ),
            "hub_call" => self.forward(
                args["server"].as_str().unwrap_or_default(),
                args["tool"].as_str().unwrap_or_default(),
                args["arguments"].clone(),
            ),
            "hub_close_server" => self.close_server(args["name"].as_str().unwrap_or_default()),
            "hub_list_combos" => self.list_combos(),
            "hub_open_combo" => self.open_combo(args["name"].as_str().unwrap_or_default()),
            other => match self.route(other) {
                Some(r) => self.forward(&r.server, &r.tool, args.clone()),
                None => Err(format!(
                    "Unknown tool {other}. Open its server with hub_open_server first."
                )),
            },
        };
        match result {
            Ok(Value::String(text)) => text_result(&text, false),
            Ok(result) => result,
            Err(text) => text_result(&text, true),
        }
    }

    fn list_servers(&self, query: &str) -> Result<Value, String> {
        let q = query.trim().to_lowercase();
        let open = self.open.lock().unwrap().clone();
        let list: Vec<Value> = self
            .entries()
            .into_iter()
            .filter(|e| {
                q.is_empty()
                    || [&e.name, &e.description]
                        .into_iter()
                        .chain(e.tags.iter())
                        .chain(e.tools.iter().map(|t| &t.name))
                        .any(|s| s.to_lowercase().contains(&q))
            })
            .map(|e| {
                let tools: Vec<String> = match open.get(&e.name) {
                    Some(c) => c
                        .tools()
                        .iter()
                        .filter_map(|t| t["name"].as_str().map(str::to_string))
                        .collect(),
                    None => e.tools.iter().map(|t| t.name.clone()).collect(),
                };
                json!({
                    "name": e.name,
                    "kind": e.kind,
                    "description": e.description,
                    "tags": e.tags,
                    "capabilities": e.capabilities,
                    "inputs": e.inputs,
                    "outputs": e.outputs,
                    "transport": if e.kind == ModuleKind::Mcp { e.config.transport.as_str() } else { "" },
                    "open": open.contains_key(&e.name),
                    "canOpen": e.runnable(),
                    "tools": tools,
                })
            })
            .collect();
        Ok(Value::String(
            serde_json::to_string_pretty(&list).unwrap_or_default(),
        ))
    }

    fn open_server(&self, name: &str) -> Result<Value, String> {
        let entry = self
            .entries()
            .into_iter()
            .find(|e| e.name == name)
            .ok_or_else(|| format!("No module named {name:?} in the hub. See hub_list_servers."))?;
        if entry.kind != ModuleKind::Mcp {
            return Ok(Value::String(guide_text(&entry)));
        }
        let client = {
            let _one = self.starting.lock().unwrap();
            let existing = self.open.lock().unwrap().get(name).cloned();
            match existing {
                Some(c) => c,
                None => {
                    let c =
                        Client::start(&entry.runtime_config(), &self.cwd, Some(self.on_change()))
                            .map_err(|e| format!("Couldn't start {name}: {e}"))?;
                    self.open
                        .lock()
                        .unwrap()
                        .insert(name.to_string(), c.clone());
                    *self.changed.lock().unwrap() = true;
                    c
                }
            }
        };
        let tools: Vec<String> = client
            .tools()
            .iter()
            .map(|t| {
                let tool = t["name"].as_str().unwrap_or_default();
                let about = t["description"]
                    .as_str()
                    .unwrap_or_default()
                    .lines()
                    .next()
                    .unwrap_or_default();
                format!("- {} (tool {tool}): {about}", exposed(name, tool))
            })
            .collect();
        let mut text = format!(
            "{name} is running with {} tools. They are now in your tool list under these names; \
             if they don't show up, get a tool's input schema with hub_list_tools and call it \
             with hub_call {{server, tool, arguments}}.\n{}",
            tools.len(),
            tools.join("\n")
        );
        if !entry.guide.trim().is_empty() {
            text.push_str(&format!("\n\nHow to use it:\n{}", entry.guide.trim()));
        }
        Ok(Value::String(text))
    }

    fn list_combos(&self) -> Result<Value, String> {
        let (modules, combos) = self.everything();
        let list: Vec<Value> = combos
            .iter()
            .map(|c| {
                let fit = c.ai_fit.clone().unwrap_or_else(|| super::fit::rule_fit(c, &modules));
                json!({
                    "name": c.name,
                    "goal": c.goal,
                    "fit": fit.score,
                    "members": c.members.iter().map(|m| json!({ "module": m.module, "role": m.role })).collect::<Vec<_>>(),
                })
            })
            .collect();
        Ok(Value::String(
            serde_json::to_string_pretty(&list).unwrap_or_default(),
        ))
    }

    /// Opens every module of a combination and says how to split the work.
    fn open_combo(&self, name: &str) -> Result<Value, String> {
        let (_, combos) = self.everything();
        let combo = combos
            .iter()
            .find(|c| c.name == name)
            .ok_or_else(|| format!("No combination named {name:?}. See hub_list_combos."))?;
        let mut text = format!("Combination {:?}", combo.name);
        if !combo.goal.is_empty() {
            text.push_str(&format!("\nGoal: {}", combo.goal));
        }
        text.push_str(
            "\nEach module below has a role. Work on the roles that don't depend on each other \
             at the same time (one subagent per role, each using its module's tools or \
             commands), and pass what one role produces to the role that needs it.\n",
        );
        let mut failed = Vec::new();
        for m in &combo.members {
            text.push_str(&format!(
                "\n## {} — role: {}\n",
                m.module,
                if m.role.is_empty() {
                    "(not set)"
                } else {
                    &m.role
                }
            ));
            match self.open_server(&m.module) {
                Ok(Value::String(t)) => text.push_str(&t),
                Ok(_) => {}
                Err(e) => {
                    text.push_str(&e);
                    failed.push(m.module.clone());
                }
            }
            text.push('\n');
        }
        if failed.len() == combo.members.len() {
            return Err(text);
        }
        Ok(Value::String(text))
    }

    /// Called from a server's reader thread when its tools change: Claude is
    /// told, and the next `tools/list` reads that server's tools again.
    fn on_change(&self) -> client::OnChange {
        let out = self.out.clone();
        Arc::new(move || {
            let mut out = out.lock().unwrap();
            let _ = writeln!(
                out,
                "{}",
                json!({ "jsonrpc": "2.0", "method": "notifications/tools/list_changed" })
            )
            .and_then(|()| out.flush());
        })
    }

    fn list_tools(&self, server: &str, only: Option<&Vec<Value>>) -> Result<Value, String> {
        let client = self.client(server)?;
        let tools = client.fresh_tools();
        let wanted: Vec<&str> = only
            .map(|a| a.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        let list: Vec<&Value> = tools
            .iter()
            .filter(|t| wanted.is_empty() || wanted.contains(&t["name"].as_str().unwrap_or("")))
            .collect();
        Ok(Value::String(
            serde_json::to_string_pretty(&list).unwrap_or_default(),
        ))
    }

    fn forward(&self, server: &str, tool: &str, args: Value) -> Result<Value, String> {
        let client = self.client(server)?;
        client.call(tool, args)
    }

    fn close_server(&self, name: &str) -> Result<Value, String> {
        match self.open.lock().unwrap().remove(name) {
            Some(c) => {
                c.close();
                *self.changed.lock().unwrap() = true;
                Ok(Value::String(format!("Stopped {name}.")))
            }
            None => Ok(Value::String(format!("{name} wasn't running."))),
        }
    }

    fn client(&self, server: &str) -> Result<Arc<Client>, String> {
        self.open
            .lock()
            .unwrap()
            .get(server)
            .cloned()
            .ok_or_else(|| format!("{server} isn't running. Start it with hub_open_server."))
    }
}

/// A CLI or library module: how to use it.
fn guide_text(e: &Entry) -> String {
    let what = if e.kind == ModuleKind::Cli {
        "command line tool"
    } else {
        "library"
    };
    let mut text = format!(
        "{} is a {what}: use it yourself (Bash or code) as described below; there are no MCP tools to call.\n",
        e.name
    );
    if let Some(dir) = &e.installed_dir {
        text.push_str(&format!("It was built in: {dir}\n"));
    }
    if !e.install.is_empty() {
        text.push_str(&format!("Set up with: {}\n", e.install.join(" && ")));
    }
    text.push('\n');
    text.push_str(if e.guide.trim().is_empty() {
        &e.description
    } else {
        e.guide.trim()
    });
    text
}

/// What Claude is told at the start: what the hub is, and what it keeps.
fn instructions(entries: &[Entry], combos: &[Combo]) -> String {
    let mut text = String::from(
        "Encela Hub keeps modules (MCP servers, command line tools, libraries) the user collected \
         without installing them. None of them run until you open one: when a task needs a \
         capability listed below, call hub_open_server with its name. An MCP module's tools \
         then appear as <server>__<tool> (hub_close_server when done); a command line tool or \
         library gives you its usage guide. hub_list_servers searches them. Combinations are \
         modules meant to be used together: hub_open_combo opens all of them with their roles.",
    );
    if !combos.is_empty() {
        text.push_str("\nCombinations:");
        for c in combos.iter().take(20) {
            let members: Vec<&str> = c.members.iter().map(|m| m.module.as_str()).collect();
            text.push_str(&format!(
                "\n- {} ({}): {}",
                c.name,
                members.join(" + "),
                c.goal
            ));
        }
    }
    if entries.is_empty() {
        text.push_str("\nThe hub is empty right now.");
    } else {
        text.push_str("\nServers in the hub:");
        for e in entries.iter().take(60) {
            let about = if e.description.is_empty() {
                e.tools
                    .iter()
                    .take(6)
                    .map(|t| t.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            } else {
                e.description.clone()
            };
            let kind = match e.kind {
                ModuleKind::Mcp => "",
                ModuleKind::Cli => " [cli]",
                ModuleKind::Library => " [library]",
            };
            text.push_str(&format!("\n- {}{kind}: {about}", e.name));
        }
    }
    text
}

fn own_tools() -> Vec<Value> {
    let name = json!({ "type": "string", "description": "The server's name in the hub" });
    let tool = |name: &str, description: &str, input: Value, read_only: bool| {
        json!({
            "name": name,
            "description": description,
            "inputSchema": input,
            "annotations": { "readOnlyHint": read_only, "destructiveHint": false, "openWorldHint": !read_only },
        })
    };
    let schema = |properties: Value, required: &[&str]| json!({ "type": "object", "properties": properties, "required": required });
    vec![
        tool(
            "hub_list_servers",
            "Lists the MCP servers kept in Encela Hub: name, what it is for, tags, whether it is running and its tools.",
            schema(
                json!({ "query": { "type": "string", "description": "Words to match in the name, description, tags or tool names; empty lists all" } }),
                &[],
            ),
            true,
        ),
        tool(
            "hub_open_server",
            "Starts a server kept in the hub and adds its tools to your tool list as <server>__<tool>.",
            schema(json!({ "name": name }), &["name"]),
            false,
        ),
        tool(
            "hub_list_tools",
            "The tools of a running hub server with their input schemas.",
            schema(
                json!({
                    "server": name,
                    "tools": { "type": "array", "items": { "type": "string" }, "description": "Only these tools (their own names); empty = all" },
                }),
                &["server"],
            ),
            true,
        ),
        tool(
            "hub_call",
            "Calls a tool of a running hub server by its own name. Use it when the <server>__<tool> tools didn't appear in your list.",
            schema(
                json!({
                    "server": name,
                    "tool": { "type": "string" },
                    "arguments": { "type": "object" },
                }),
                &["server", "tool"],
            ),
            false,
        ),
        tool(
            "hub_close_server",
            "Stops a running hub server and removes its tools.",
            schema(json!({ "name": name }), &["name"]),
            false,
        ),
        tool(
            "hub_list_combos",
            "Lists combinations of hub modules: name, goal, fit (0-100) and each module's role.",
            schema(json!({}), &[]),
            true,
        ),
        tool(
            "hub_open_combo",
            "Opens every module of a combination at once and returns each one's role, tools and usage guide, to work on the roles in parallel.",
            schema(
                json!({ "name": { "type": "string", "description": "The combination's name" } }),
                &["name"],
            ),
            false,
        ),
    ]
}

/// `<server>__<tool>` as a tool name: letters, digits, `_` and `-`, short
/// enough for Claude Code's prefix (long ones end with a hash, to stay apart).
pub fn exposed(server: &str, tool: &str) -> String {
    let clean = |s: &str| -> String {
        s.chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                    c
                } else {
                    '_'
                }
            })
            .collect()
    };
    let full = format!("{}__{}", clean(server), clean(tool));
    if full.len() <= MAX_TOOL_NAME {
        return full;
    }
    let hash = Sha256::digest(format!("{server}\0{tool}").as_bytes());
    let suffix: String = hash.iter().take(3).map(|b| format!("{b:02x}")).collect();
    format!("{}_{suffix}", &full[..MAX_TOOL_NAME - suffix.len() - 1])
}

fn text_result(text: &str, is_error: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": is_error })
}

fn error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::Config;
    use crate::mcp_hub::{Member, ToolInfo, store_all};

    fn hub(entries: &[Entry]) -> (Hub, PathBuf) {
        hub_with(entries, &[])
    }

    fn hub_with(entries: &[Entry], combos: &[Combo]) -> (Hub, PathBuf) {
        let dir = std::env::temp_dir().join(format!("encela-gw-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let all = super::super::Hub {
            modules: entries.to_vec(),
            combos: combos.to_vec(),
        };
        store_all(&dir, &all).unwrap();
        let out = Arc::new(Mutex::new(std::io::stdout()));
        (Hub::new(dir.clone(), std::env::temp_dir(), out), dir)
    }

    fn entry(name: &str, in_hub: bool) -> Entry {
        Entry {
            name: name.into(),
            description: format!("{name} things"),
            tags: vec!["security".into()],
            config: Config {
                transport: "stdio".into(),
                command: "definitely-not-a-real-command-xyz".into(),
                ..Config::default()
            },
            in_hub,
            tools: vec![ToolInfo {
                name: "scan".into(),
                description: String::new(),
            }],
            ..Entry::default()
        }
    }

    fn call(hub: &Hub, name: &str, args: Value) -> Value {
        let reply = hub
            .handle(&json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": name, "arguments": args } }))
            .unwrap();
        reply["result"].clone()
    }

    #[test]
    fn exposed_names_fit_and_stay_apart() {
        assert_eq!(exposed("rea", "run_scan"), "rea__run_scan");
        assert_eq!(exposed("my.srv", "a b"), "my_srv__a_b");
        let long = "x".repeat(80);
        let a = exposed("srv", &format!("{long}1"));
        let b = exposed("srv", &format!("{long}2"));
        assert!(a.len() <= MAX_TOOL_NAME && b.len() <= MAX_TOOL_NAME);
        assert_ne!(a, b);
    }

    #[test]
    fn initialize_lists_only_hub_servers() {
        let (hub, dir) = hub(&[entry("rea", true), entry("hidden", false)]);
        let reply = hub
            .handle(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26" } }))
            .unwrap();
        let text = reply["result"]["instructions"].as_str().unwrap();
        assert!(text.contains("- rea: rea things"));
        assert!(!text.contains("hidden"));
        assert_eq!(reply["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(
            reply["result"]["capabilities"]["tools"]["listChanged"],
            true
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn servers_are_searched_and_unknown_ones_refused() {
        let (hub, dir) = hub(&[entry("rea", true), entry("artex", true)]);
        let text = call(&hub, "hub_list_servers", json!({ "query": "ART" }))["content"][0]["text"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(text.contains("artex") && !text.contains("\"rea\""));

        let r = call(&hub, "hub_open_server", json!({ "name": "nope" }));
        assert_eq!(r["isError"], true);
        // Starting a command that doesn't exist is a readable tool error.
        let r = call(&hub, "hub_open_server", json!({ "name": "rea" }));
        assert_eq!(r["isError"], true);
        assert!(
            r["content"][0]["text"]
                .as_str()
                .unwrap()
                .contains("Couldn't start rea")
        );
        let r = call(&hub, "rea__scan", json!({}));
        assert_eq!(r["isError"], true);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_tool_list_starts_with_the_hub_tools() {
        let (hub, dir) = hub(&[]);
        let names: Vec<String> = hub
            .tool_list()
            .iter()
            .map(|t| t["name"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(
            names,
            [
                "hub_list_servers",
                "hub_open_server",
                "hub_list_tools",
                "hub_call",
                "hub_close_server",
                "hub_list_combos",
                "hub_open_combo"
            ]
        );
        for t in hub.tool_list() {
            assert_eq!(t["inputSchema"]["type"], "object");
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn an_opened_server_shows_its_tools_and_answers_through_the_hub() {
        let script = r#"
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"t","version":"1"}}}\n' "$id" ;;
    *'"tools/list"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"tools":[{"name":"scan","description":"Scan a host","inputSchema":{"type":"object"}}]}}\n' "$id" ;;
    *'"tools/call"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"done"}]}}\n' "$id" ;;
  esac
done
"#;
        let mut e = entry("rea", true);
        e.config.command = "sh".into();
        e.config.args = vec!["-c".into(), script.into()];
        let (hub, dir) = hub(&[e]);
        let r = call(&hub, "hub_open_server", json!({ "name": "rea" }));
        assert_eq!(r["isError"], false, "{r}");
        assert!(
            r["content"][0]["text"]
                .as_str()
                .unwrap()
                .contains("rea__scan")
        );
        let names: Vec<Value> = hub.tool_list().iter().map(|t| t["name"].clone()).collect();
        assert!(names.contains(&json!("rea__scan")));
        assert_eq!(
            call(&hub, "rea__scan", json!({}))["content"][0]["text"],
            "done"
        );
        let via = call(&hub, "hub_call", json!({ "server": "rea", "tool": "scan" }));
        assert_eq!(via["content"][0]["text"], "done");
        call(&hub, "hub_close_server", json!({ "name": "rea" }));
        assert_eq!(hub.tool_list().len(), own_tools().len());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_cli_module_opens_as_its_guide() {
        let cli = Entry {
            name: "jq".into(),
            kind: ModuleKind::Cli,
            guide: "Run `jq '.x' file`".into(),
            install: vec!["brew install jq".into()],
            in_hub: true,
            ..Entry::default()
        };
        let (hub, dir) = hub(&[cli]);
        let r = call(&hub, "hub_open_server", json!({ "name": "jq" }));
        assert_eq!(r["isError"], false);
        let text = r["content"][0]["text"].as_str().unwrap();
        assert!(
            text.contains("command line tool") && text.contains("jq '.x'"),
            "{text}"
        );
        assert_eq!(
            hub.tool_list().len(),
            own_tools().len(),
            "no tools for a CLI"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_combination_opens_its_members_with_their_roles() {
        let cli = Entry {
            name: "jq".into(),
            kind: ModuleKind::Cli,
            guide: "filter json".into(),
            in_hub: true,
            ..Entry::default()
        };
        let combo = Combo {
            name: "rebuild".into(),
            goal: "Rebuild and test".into(),
            members: vec![
                Member {
                    module: "rea".into(),
                    role: "reverse it".into(),
                },
                Member {
                    module: "jq".into(),
                    role: "shape the output".into(),
                },
            ],
            ai_fit: None,
        };
        let (hub, dir) = hub_with(&[entry("rea", true), cli], &[combo]);
        let init = hub
            .handle(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }))
            .unwrap();
        assert!(
            init["result"]["instructions"]
                .as_str()
                .unwrap()
                .contains("rebuild (rea + jq)")
        );
        let list = call(&hub, "hub_list_combos", json!({}));
        assert!(
            list["content"][0]["text"]
                .as_str()
                .unwrap()
                .contains("\"fit\"")
        );
        // rea can't start here, jq can: the combination still opens, saying so.
        let r = call(&hub, "hub_open_combo", json!({ "name": "rebuild" }));
        assert_eq!(r["isError"], false, "{r}");
        let text = r["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("role: reverse it") && text.contains("Couldn't start rea"));
        assert!(text.contains("filter json"));
        assert_eq!(
            call(&hub, "hub_open_combo", json!({ "name": "x" }))["isError"],
            true
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
