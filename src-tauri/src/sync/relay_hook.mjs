#!/usr/bin/env node
// Encela cloud relay (written by the Encela app; safe to commit).
//
// In a cloud Claude Code session (claude.ai/code), sends each prompt
// (UserPromptSubmit), Claude's answer (Stop) and each tool call (PreToolUse,
// PostToolUse: the tool, its file or command, lines changed; no file
// contents) to the Encela app on your computer through the Firebase Realtime
// Database, and adds what you chose in Encela to the next prompt. It does
// nothing unless the session is remote and has the relay key (written in
// below by Encela's setup script, or the environment's ENCELA_RELAY), and it
// never blocks or fails the session: tool calls are sent in the background.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DATABASE = "__DATABASE__";
const TIMEOUT_S = "4";
const MAX_TEXT = 20000;
const MAX_DETAIL = 300;
const KINDS = ["prompt", "answer", "tool", "toolEnd"];

function quit() {
  process.exit(0);
}

const kind = process.argv[2];
const token = process.env.ENCELA_RELAY || "__TOKEN__";
if (process.env.CLAUDE_CODE_REMOTE !== "true" || !/^[0-9a-f]{64}$/.test(token)) quit();
if (!KINDS.includes(kind)) quit();

// Installed both for the user and in the project: the project's copy reports.
const own = join(process.env.CLAUDE_PROJECT_DIR ?? "", ".claude/hooks/encela-relay.mjs");
if (process.env.CLAUDE_PROJECT_DIR && fileURLToPath(import.meta.url) !== own && existsSync(own)) {
  quit();
}

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  quit();
}

const base = `${DATABASE}/relays/${token}`;

function curl(args) {
  try {
    return execFileSync("curl", ["-sS", "-m", TIMEOUT_S, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

/** Sends an event; `wait` false leaves curl running after this hook exits. */
function post(event, wait) {
  const args = ["-X", "POST", "-H", "Content-Type: application/json", "--data-binary", JSON.stringify(event), `${base}/events.json`];
  if (wait) {
    curl(args);
    return;
  }
  try {
    spawn("curl", ["-sS", "-m", TIMEOUT_S, ...args], { detached: true, stdio: "ignore" }).unref();
  } catch {}
}

/** `owner__repo` of the origin remote, the key the app files it under. */
function repoKey(cwd) {
  let url = "";
  try {
    url = execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
  const parts = url
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .split(/[/:]/)
    .filter(Boolean);
  if (parts.length < 2) return "";
  return parts
    .slice(-2)
    .join("__")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 200);
}

/** The text of Claude's last answer: given by newer Claude Code, else read from the transcript. */
function lastAnswer() {
  if (typeof input.last_assistant_message === "string") return input.last_assistant_message;
  if (typeof input.transcript_path !== "string") return "";
  let lines = [];
  try {
    lines = readFileSync(input.transcript_path, "utf8").trim().split("\n");
  } catch {
    return "";
  }
  const texts = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const content = entry.message?.content;
    // The prompt that started this answer.
    if (entry.type === "user" && typeof content === "string") break;
    if (entry.type !== "assistant" || !Array.isArray(content)) continue;
    for (const part of [...content].reverse()) {
      if (part.type === "text" && part.text) texts.unshift(part.text);
    }
  }
  return texts.join("\n\n");
}

const str = (v) => (typeof v === "string" ? v : "");
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const count = (s) => (s ? s.split("\n").length : 0);

/** The file or pattern a tool works on, and a line about what it does (as the mod's activity.ts). */
function describe(tool, args) {
  switch (tool) {
    case "Read":
    case "Edit":
    case "MultiEdit":
    case "Write":
      return { target: str(args.file_path), detail: "" };
    case "NotebookEdit":
      return { target: str(args.notebook_path), detail: "" };
    case "Grep":
    case "Glob":
      return { target: str(args.path), detail: str(args.pattern) };
    case "Bash":
      return { target: "", detail: str(args.command) };
    case "Agent":
    case "Task":
      return { target: "", detail: str(args.description) || str(args.subagent_type) };
    case "WebFetch":
      return { target: "", detail: str(args.url) };
    case "WebSearch":
      return { target: "", detail: str(args.query) };
    case "AskUserQuestion":
      return { target: "", detail: Array.isArray(args.questions) ? str(args.questions[0]?.question) : "" };
    default:
      return { target: "", detail: "" };
  }
}

function size(tool, args) {
  if (tool === "Edit") return { added: count(str(args.new_string)), removed: count(str(args.old_string)) };
  if (tool === "MultiEdit" && Array.isArray(args.edits)) {
    let added = 0;
    let removed = 0;
    for (const e of args.edits) {
      added += count(str(e?.new_string));
      removed += count(str(e?.old_string));
    }
    return { added, removed };
  }
  if (tool === "Write") return { added: count(str(args.content)), removed: 0 };
  return { added: 0, removed: 0 };
}

const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
const repo = repoKey(cwd);
const event = {
  kind,
  session: String(input.session_id ?? "").slice(0, 200),
  repo,
  at: Date.now(),
};

if (kind === "tool" || kind === "toolEnd") {
  const tool = str(input.tool_name).slice(0, 200);
  const args = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  event.tool = tool;
  event.id = str(input.tool_use_id).slice(0, 200);
  if (input.agent_id) event.agent = String(input.agent_id).slice(0, 200);
  if (kind === "tool") {
    const { target, detail } = describe(tool, args);
    event.target = cut(target, 1000);
    event.detail = cut(detail, MAX_DETAIL);
  } else {
    Object.assign(event, size(tool, args), { ok: true });
  }
  post(event, false);
  quit();
}

const text = (kind === "prompt" ? String(input.prompt ?? "") : lastAnswer()).slice(0, MAX_TEXT);
if (!text.trim()) quit();
post({ ...event, text }, true);

// What the user chose in Encela and the project's decisions go into this prompt.
if (kind === "prompt" && repo) {
  let context = "";
  try {
    context = JSON.parse(curl([`${base}/context/${repo}/text.json`])) ?? "";
  } catch {}
  if (typeof context === "string" && context.trim()) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
      }),
    );
  }
}
quit();
