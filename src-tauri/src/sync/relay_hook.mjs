#!/usr/bin/env node
// Encela cloud relay (written by the Encela app; safe to commit).
//
// In a cloud Claude Code session (claude.ai/code), sends each prompt
// (UserPromptSubmit) and Claude's answer (Stop) to the Encela app on your
// computer through Firestore, and adds what you chose in Encela to the next
// prompt. It does nothing unless the session is remote and has the relay key
// (written in below by Encela's setup script, or the environment's
// ENCELA_RELAY), and it never blocks or fails the session.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT = "__PROJECT__";
const API_KEY = "__API_KEY__";
const TIMEOUT_S = "4";
const MAX_TEXT = 20000;

function quit() {
  process.exit(0);
}

const kind = process.argv[2];
const token = process.env.ENCELA_RELAY || "__TOKEN__";
if (process.env.CLAUDE_CODE_REMOTE !== "true" || !/^[0-9a-f]{64}$/.test(token)) quit();
if (kind !== "prompt" && kind !== "answer") quit();

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

const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/relays/${token}`;

function curl(args, body) {
  try {
    return execFileSync("curl", ["-sS", "-m", TIMEOUT_S, ...args], {
      input: body,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
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

const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
const repo = repoKey(cwd);
const text = (kind === "prompt" ? String(input.prompt ?? "") : lastAnswer()).slice(0, MAX_TEXT);
if (!text.trim()) quit();

const str = (v) => ({ stringValue: v });
curl(
  ["-X", "POST", "-H", "Content-Type: application/json", "--data-binary", "@-", `${base}/events?key=${API_KEY}`],
  JSON.stringify({
    fields: {
      kind: str(kind),
      session: str(String(input.session_id ?? "").slice(0, 200)),
      repo: str(repo),
      text: str(text),
      at: { integerValue: String(Date.now()) },
    },
  }),
);

// What the user chose in Encela and the project's decisions go into this prompt.
if (kind === "prompt" && repo) {
  let context = "";
  try {
    context = JSON.parse(curl([`${base}/context/${repo}?key=${API_KEY}`])).fields?.text?.stringValue ?? "";
  } catch {}
  if (context.trim()) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
      }),
    );
  }
}
quit();
