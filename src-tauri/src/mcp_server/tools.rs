//! The MCP server's tools: branch notes, to-dos and PR/CI status from the
//! bridge, the block catalog, and the app's automations.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

use crate::automation;
use crate::bridge::{self, Request};
use crate::catalog::{Block, BlockKind, blocks as catalog};

/// `state.json` is rewritten every 30 seconds while the app runs.
const RUNNING_WITHIN_MS: i64 = 90_000;
const SEARCH_LIMIT: usize = 60;

type ToolResult = Result<Value, String>;

pub struct Server {
    data_dir: PathBuf,
}

/// A tool's input schema: an object with these properties, `required` ones first.
fn schema(properties: Value, required: &[&str]) -> Value {
    json!({ "type": "object", "properties": properties, "required": required })
}

fn tool(name: &str, description: &str, input: Value, read_only: bool) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": input,
        "annotations": { "readOnlyHint": read_only, "destructiveHint": false, "openWorldHint": false },
    })
}

pub fn definitions() -> Vec<Value> {
    let path = json!({ "type": "string", "description": "Project folder (default: the current directory)" });
    let branch =
        json!({ "type": "string", "description": "Branch (default: the checked-out one)" });
    vec![
        tool(
            "get_branch_context",
            "The branch's note, to-dos (with ids) and PR/CI status as kept in the Encela app, plus other branches with open to-dos.",
            schema(json!({ "path": path, "branch": branch }), &[]),
            true,
        ),
        tool(
            "add_todo",
            "Adds a to-do to the branch in Encela.",
            schema(
                json!({ "text": { "type": "string" }, "path": path, "branch": branch }),
                &["text"],
            ),
            false,
        ),
        tool(
            "set_todo_done",
            "Marks a to-do done or not done (id from get_branch_context).",
            schema(
                json!({ "id": { "type": "string" }, "done": { "type": "boolean" } }),
                &["id", "done"],
            ),
            false,
        ),
        tool(
            "append_note",
            "Adds lines to the end of the branch's note in Encela (decisions, progress, what is left).",
            schema(
                json!({ "text": { "type": "string" }, "path": path, "branch": branch }),
                &["text"],
            ),
            false,
        ),
        tool(
            "search_blocks",
            "Searches Encela's block catalog (instructions, rules, skills, subagents, hooks, and the user's library). Returns ids for get_block.",
            schema(
                json!({
                    "query": { "type": "string", "description": "Words to match in the title, summary or category; empty lists all" },
                    "kind": { "type": "string", "enum": ["instruction", "rule", "skill", "agent", "hook"] },
                }),
                &[],
            ),
            true,
        ),
        tool(
            "get_block",
            "A catalog block in full: what it does, its text and where it comes from.",
            schema(json!({ "id": { "type": "string" } }), &["id"]),
            true,
        ),
        tool(
            "list_automations",
            "Automations saved in Encela: each one's schedule, model, prompt, subagents, allowed tools, email, whether it is on, the next run, and its latest runs.",
            schema(json!({}), &[]),
            true,
        ),
        tool(
            "save_automation",
            "Creates an automation in Encela, or changes one (pass its id). Encela runs it with the user's own `claude -p` on the schedule while Encela is running. Tools not in allowedTools are refused, so list every tool the task needs (e.g. WebSearch, WebFetch, Read). With an email, the result is mailed through the user's email MCP server (mailTool, default mcp__claude_ai_Gmail).",
            schema(
                json!({
                    "id": { "type": "string", "description": "Omit to create a new one" },
                    "name": { "type": "string" },
                    "prompt": { "type": "string", "description": "What to do on each run" },
                    "schedule": {
                        "type": "object",
                        "description": "{\"kind\":\"daily\",\"time\":\"10:00\",\"days\":[1,2,3,4,5]} (days 0=Sunday..6, empty = every day) or {\"kind\":\"interval\",\"minutes\":60} (at least 5)",
                        "properties": {
                            "kind": { "type": "string", "enum": ["daily", "interval"] },
                            "time": { "type": "string" },
                            "days": { "type": "array", "items": { "type": "integer" } },
                            "minutes": { "type": "integer" },
                        },
                        "required": ["kind"],
                    },
                    "model": { "type": "string", "description": "haiku, sonnet, opus, fable or a model id; empty = default" },
                    "instructions": { "type": "string", "description": "Added to the system prompt" },
                    "agents": {
                        "type": "object",
                        "description": "Subagents by name (lowercase, digits, -): {description, prompt, model?, tools?}",
                        "additionalProperties": {
                            "type": "object",
                            "properties": {
                                "description": { "type": "string" },
                                "prompt": { "type": "string" },
                                "model": { "type": "string" },
                                "tools": { "type": "array", "items": { "type": "string" } },
                            },
                            "required": ["description", "prompt"],
                        },
                    },
                    "allowedTools": { "type": "array", "items": { "type": "string" } },
                    "project": { "type": "string", "description": "Folder to run in; empty = the automation's own folder" },
                    "email": { "type": "string", "description": "Mail the result here" },
                    "mailTool": { "type": "string" },
                    "enabled": { "type": "boolean" },
                }),
                &["name", "prompt", "schedule"],
            ),
            false,
        ),
        tool(
            "set_automation_enabled",
            "Turns an automation on or off.",
            schema(
                json!({ "id": { "type": "string" }, "enabled": { "type": "boolean" } }),
                &["id", "enabled"],
            ),
            false,
        ),
        tool(
            "run_automation",
            "Runs an automation now in Encela (Encela must be running). Check list_automations later for the result.",
            schema(json!({ "id": { "type": "string" } }), &["id"]),
            false,
        ),
    ]
}

fn text_result(value: &Value) -> Value {
    let text = serde_json::to_string_pretty(value).unwrap_or_default();
    json!({ "content": [{ "type": "text", "text": text }] })
}

fn error_result(message: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": message }], "isError": true })
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn str_arg<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args[key].as_str().map(str::trim).filter(|s| !s.is_empty())
}

fn required<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    str_arg(args, key).ok_or_else(|| format!("`{key}` is required"))
}

/// The repository and branch memos are filed under, as the app files them.
struct Target {
    repo_key: String,
    repo_name: String,
    branch: String,
}

impl Server {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }

    fn bridge(&self) -> PathBuf {
        bridge::dir_in(&self.data_dir)
    }

    /// What the app last exported, if it ever ran.
    fn state(&self) -> Option<Value> {
        let bytes = std::fs::read(self.bridge().join("state.json")).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    fn app_running(state: Option<&Value>) -> bool {
        state
            .and_then(|s| s["heartbeat"].as_i64())
            .is_some_and(|t| now_ms() - t < RUNNING_WITHIN_MS)
    }

    fn catalog(&self) -> Vec<Block> {
        let library = crate::library::items_at(&self.data_dir);
        catalog::all(&library, Some(&self.data_dir.join("catalog-cache")))
    }

    /// Answers `tools/call`: a tool result, or a JSON-RPC error for an unknown tool.
    pub fn call(&self, name: &str, args: &Value) -> Result<Value, (i64, String)> {
        let result = match name {
            "get_branch_context" => self.branch_context(args),
            "add_todo" => self.add_todo(args),
            "set_todo_done" => self.set_todo_done(args),
            "append_note" => self.append_note(args),
            "search_blocks" => self.search_blocks(args),
            "get_block" => self.get_block(args),
            "list_automations" => self.list_automations(),
            "save_automation" => self.save_automation(args),
            "set_automation_enabled" => self.set_automation_enabled(args),
            "run_automation" => self.run_automation(args),
            _ => return Err((-32602, format!("Unknown tool: {name}"))),
        };
        Ok(match result {
            Ok(value) => text_result(&value),
            Err(message) => error_result(&message),
        })
    }

    fn target(&self, args: &Value, state: Option<&Value>) -> Result<Target, String> {
        let dir = match str_arg(args, "path") {
            Some(p) => PathBuf::from(p),
            None => std::env::current_dir().map_err(|e| e.to_string())?,
        };
        let info = crate::memo::repo::inspect(&dir)?;
        let mut repo_key = info.key.clone();
        // A repository that got its remote after memos were written under its path.
        if let Some(state) = state
            && state["repos"].get(&repo_key).is_none()
            && let Some(path_key) = &info.path_key
            && let Some(key) = state["paths"][path_key].as_str()
        {
            repo_key = key.to_string();
        }
        let branch = match str_arg(args, "branch") {
            Some(b) => b.to_string(),
            None if !info.is_git => String::new(),
            None => info.branch.clone().ok_or_else(|| {
                "No branch is checked out (detached HEAD); pass `branch`.".to_string()
            })?,
        };
        Ok(Target {
            repo_key,
            repo_name: info.name,
            branch,
        })
    }

    fn branch_context(&self, args: &Value) -> ToolResult {
        let state = self.state();
        let target = self.target(args, state.as_ref())?;
        let branches = state
            .as_ref()
            .and_then(|s| s["repos"].get(&target.repo_key))
            .and_then(Value::as_object);
        let here = branches.and_then(|b| b.get(&target.branch));
        let others: Vec<Value> = branches
            .into_iter()
            .flatten()
            .filter(|(name, _)| **name != target.branch)
            .filter_map(|(name, data)| {
                let open = data["todos"]
                    .as_array()?
                    .iter()
                    .filter(|t| t["done"] != true)
                    .count();
                (open > 0).then(|| json!({ "branch": name, "openTodos": open }))
            })
            .collect();
        Ok(json!({
            "appRunning": Self::app_running(state.as_ref()),
            "repo": { "key": target.repo_key, "name": target.repo_name },
            "branch": target.branch,
            "note": here.map(|h| h["note"].clone()).unwrap_or(json!("")),
            "todos": here.map(|h| h["todos"].clone()).unwrap_or(json!([])),
            "github": here.map(|h| h["github"].clone()).unwrap_or(Value::Null),
            "otherBranchesWithOpenTodos": others,
            "appNeverRan": state.is_none(),
        }))
    }

    /// Leaves `request` for the app; says whether it applies now or on next start.
    fn send(&self, request: Request, done: Value) -> ToolResult {
        bridge::enqueue(&self.bridge(), &request).map_err(|e| e.to_string())?;
        let running = Self::app_running(self.state().as_ref());
        let mut done = done;
        done["applied"] = json!(if running {
            "Encela applies it within a few seconds"
        } else {
            "Encela isn't running; it applies this the next time it starts"
        });
        Ok(done)
    }

    fn add_todo(&self, args: &Value) -> ToolResult {
        let text = required(args, "text")?.to_string();
        let target = self.target(args, self.state().as_ref())?;
        let done = json!({ "added": text, "branch": target.branch });
        self.send(
            Request::AddTodo {
                repo_key: target.repo_key,
                branch: target.branch,
                text,
            },
            done,
        )
    }

    fn set_todo_done(&self, args: &Value) -> ToolResult {
        let id = required(args, "id")?.to_string();
        let done = args["done"]
            .as_bool()
            .ok_or("`done` must be true or false")?;
        self.send(
            Request::SetDone {
                id: id.clone(),
                done,
            },
            json!({ "id": id, "done": done }),
        )
    }

    fn append_note(&self, args: &Value) -> ToolResult {
        let text = required(args, "text")?.to_string();
        let target = self.target(args, self.state().as_ref())?;
        let done = json!({ "appended": text, "branch": target.branch });
        self.send(
            Request::AppendNote {
                repo_key: target.repo_key,
                branch: target.branch,
                text,
            },
            done,
        )
    }

    fn search_blocks(&self, args: &Value) -> ToolResult {
        let kind: Option<BlockKind> = match str_arg(args, "kind") {
            None => None,
            Some(k) => {
                Some(serde_json::from_value(json!(k)).map_err(|_| format!("Unknown kind: {k}"))?)
            }
        };
        let catalog = self.catalog();
        let found = search(&catalog, str_arg(args, "query").unwrap_or_default(), kind);
        let total = found.len();
        let blocks: Vec<Value> = found
            .into_iter()
            .take(SEARCH_LIMIT)
            .map(|b| {
                let mut v = json!({
                    "id": b.id,
                    "kind": b.kind,
                    "title": b.title,
                    "summary": b.summary,
                    "category": b.category,
                });
                if let Some(en) = &b.en {
                    v["titleEn"] = json!(en.title);
                }
                v
            })
            .collect();
        Ok(json!({ "total": total, "blocks": blocks }))
    }

    fn get_block(&self, args: &Value) -> ToolResult {
        let id = required(args, "id")?;
        let catalog = self.catalog();
        let block = catalog
            .iter()
            .find(|b| b.id == id)
            .ok_or_else(|| format!("No block with id {id}; use search_blocks"))?;
        serde_json::to_value(block).map_err(|e| e.to_string())
    }

    fn list_automations(&self) -> ToolResult {
        let runs = automation::read_runs(&self.data_dir);
        let list: Vec<Value> = automation::read_automations(&self.data_dir)
            .into_iter()
            .map(|a| {
                let latest: Vec<&automation::Run> = runs
                    .iter()
                    .rev()
                    .filter(|r| r.automation_id == a.id)
                    .take(3)
                    .collect();
                let next = automation::next_run_at(&a);
                let mut v = serde_json::to_value(&a).unwrap_or_default();
                v["nextRunAt"] = json!(next);
                v["latestRuns"] = serde_json::to_value(latest).unwrap_or_default();
                v
            })
            .collect();
        Ok(json!({
            "appRunning": Self::app_running(self.state().as_ref()),
            "automations": list,
        }))
    }

    fn save_automation(&self, args: &Value) -> ToolResult {
        let mut value = args.clone();
        let existing = str_arg(args, "id").and_then(|id| {
            automation::read_automations(&self.data_dir)
                .into_iter()
                .find(|a| a.id == id)
        });
        if str_arg(args, "id").is_some() && existing.is_none() {
            return Err("No automation with that id; use list_automations".into());
        }
        // A change keeps what it doesn't mention.
        if let Some(old) = &existing
            && let (Some(fields), Ok(Value::Object(mut base))) =
                (args.as_object(), serde_json::to_value(old))
        {
            for (k, v) in fields {
                base.insert(k.clone(), v.clone());
            }
            value = Value::Object(base);
        }
        if value
            .get("id")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        {
            value["id"] = json!(format!(
                "auto-{}",
                &uuid::Uuid::new_v4().simple().to_string()[..12]
            ));
        }
        let parsed: automation::Automation = serde_json::from_value(value.clone())
            .map_err(|e| format!("Invalid automation: {e}"))?;
        // Checked here too, so mistakes come back to Claude now.
        let checked = automation::normalize(parsed, existing.as_ref(), automation::now_ms())?;
        let next = automation::next_run_at(&checked);
        self.send(
            Request::SaveAutomation { automation: value },
            json!({ "id": checked.id, "name": checked.name, "nextRunAt": next, "allowedTools": checked.allowed_tools }),
        )
    }

    fn set_automation_enabled(&self, args: &Value) -> ToolResult {
        let id = required(args, "id")?.to_string();
        let enabled = args["enabled"]
            .as_bool()
            .ok_or("`enabled` must be true or false")?;
        self.known_automation(&id)?;
        self.send(
            Request::SetAutomationEnabled {
                id: id.clone(),
                enabled,
            },
            json!({ "id": id, "enabled": enabled }),
        )
    }

    fn run_automation(&self, args: &Value) -> ToolResult {
        let id = required(args, "id")?.to_string();
        self.known_automation(&id)?;
        if !Self::app_running(self.state().as_ref()) {
            return Err("Encela isn't running; open it to run automations".into());
        }
        self.send(
            Request::RunAutomation { id: id.clone() },
            json!({ "started": id }),
        )
    }

    fn known_automation(&self, id: &str) -> Result<(), String> {
        automation::read_automations(&self.data_dir)
            .iter()
            .any(|a| a.id == id)
            .then_some(())
            .ok_or_else(|| "No automation with that id; use list_automations".into())
    }
}

/// Blocks whose id, titles, summary or category hold every word of `query`.
fn search<'a>(catalog: &'a [Block], query: &str, kind: Option<BlockKind>) -> Vec<&'a Block> {
    let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
    catalog
        .iter()
        .filter(|b| kind.is_none_or(|k| b.kind == k))
        .filter(|b| {
            let mut hay = format!("{} {} {} {}", b.id, b.title, b.summary, b.category);
            if let Some(en) = &b.en {
                hay.push_str(&format!(" {} {} {}", en.title, en.summary, en.category));
            }
            let hay = hay.to_lowercase();
            words.iter().all(|w| hay.contains(w))
        })
        .collect()
}

/// Lets tests point `Server` at a folder laid out like the app's.
#[cfg(test)]
pub fn write_state(data_dir: &std::path::Path, state: &Value) {
    let dir = bridge::dir_in(data_dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("state.json"), state.to_string()).unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("encela-tools-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn inbox(dir: &std::path::Path) -> Vec<Value> {
        let mut files: Vec<PathBuf> = std::fs::read_dir(bridge::dir_in(dir).join("inbox"))
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .collect();
        files.sort();
        files
            .iter()
            .map(|p| serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap())
            .collect()
    }

    fn text(result: &Value) -> Value {
        serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap()
    }

    #[test]
    fn branch_context_reads_the_export_for_a_non_git_folder() {
        let dir = temp();
        let project = temp();
        let key = format!(
            "path:{}",
            std::fs::canonicalize(&project).unwrap().display()
        );
        write_state(
            &dir,
            &json!({
                "version": 1, "heartbeat": now_ms(), "locale": "ko", "paths": {},
                "repos": { key.clone(): { "": { "note": "n1", "todos": [{ "id": "t1", "text": "x", "done": false }] } } },
            }),
        );
        let server = Server::new(dir.clone());
        let args = json!({ "path": project.display().to_string() });
        let out = text(&server.call("get_branch_context", &args).unwrap());
        assert_eq!(out["repo"]["key"], key);
        assert_eq!(out["note"], "n1");
        assert_eq!(out["todos"][0]["id"], "t1");
        assert_eq!(out["appRunning"], true);

        // Writes go to the inbox in the app's request format.
        let added = server
            .call(
                "add_todo",
                &json!({ "text": "y", "path": project.display().to_string() }),
            )
            .unwrap();
        assert!(added.get("isError").is_none());
        let done = server
            .call("set_todo_done", &json!({ "id": "t1", "done": true }))
            .unwrap();
        assert!(done.get("isError").is_none());
        let requests = inbox(&dir);
        assert_eq!(requests[0]["op"], "addTodo");
        assert_eq!(requests[0]["repoKey"], key);
        assert_eq!(
            requests[1],
            json!({ "op": "setDone", "id": "t1", "done": true })
        );
        for r in requests {
            serde_json::from_value::<Request>(r).unwrap();
        }
        std::fs::remove_dir_all(dir).unwrap();
        std::fs::remove_dir_all(project).unwrap();
    }

    #[test]
    fn bad_input_is_a_tool_error_not_a_protocol_error() {
        let dir = temp();
        let server = Server::new(dir.clone());
        let out = server.call("add_todo", &json!({})).unwrap();
        assert_eq!(out["isError"], true);
        assert!(server.call("no_such_tool", &json!({})).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn search_matches_every_word_and_filters_by_kind() {
        let catalog = catalog::all(&[], None);
        let all = search(&catalog, "", None);
        assert_eq!(all.len(), catalog.len());
        let rules = search(&catalog, "", Some(BlockKind::Rule));
        assert!(!rules.is_empty() && rules.iter().all(|b| b.kind == BlockKind::Rule));
        let ts = search(&catalog, "typescript", Some(BlockKind::Rule));
        assert!(ts.iter().any(|b| b.id == "builtin:typescript"));
        assert!(search(&catalog, "typescript zzzz-nothing", None).is_empty());
    }

    #[test]
    fn automations_are_checked_then_left_for_the_app() {
        let dir = temp();
        let server = Server::new(dir.clone());
        let bad = server
            .call(
                "save_automation",
                &json!({ "name": "x", "prompt": "y", "schedule": { "kind": "interval", "minutes": 1 } }),
            )
            .unwrap();
        assert_eq!(bad["isError"], true);
        assert!(!bridge::dir_in(&dir).join("inbox").exists());

        let ok = server
            .call(
                "save_automation",
                &json!({
                    "name": "News", "prompt": "Collect AI news",
                    "schedule": { "kind": "daily", "time": "10:00" },
                    "agents": { "scraper": { "description": "d", "prompt": "p", "model": "haiku" } },
                    "allowedTools": ["WebSearch"], "email": "me@example.com",
                }),
            )
            .unwrap();
        let reply = text(&ok);
        let id = reply["id"].as_str().unwrap().to_string();
        assert!(id.starts_with("auto-"));
        assert_eq!(reply["allowedTools"], json!(["WebSearch"]));
        let sent = inbox(&dir);
        assert_eq!(sent[0]["op"], "saveAutomation");
        assert_eq!(sent[0]["automation"]["id"], id.as_str());

        // Unknown ids are refused before anything is sent.
        let missing = server
            .call("run_automation", &json!({ "id": "auto-nope" }))
            .unwrap();
        assert_eq!(missing["isError"], true);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
