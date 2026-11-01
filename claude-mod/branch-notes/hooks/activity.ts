// What Claude Code is doing, for the app's live view: one step per tool call
// (the tool, the file or command, lines changed) and per turn. No engine
// imports, so tests can call it directly. The app (src-tauri/src/activity.rs)
// sorts tools into kinds, makes paths relative and masks secrets.

/** One step as `activity.rs` reads it (`Step`). */
export type Step = {
  at: number;
  kind: "turn" | "tool" | "toolEnd" | "usage";
  id?: string;
  phase?: "start" | "end";
  tool?: string;
  target?: string;
  detail?: string;
  /** The end of a main-loop turn: Claude's answer (the app masks and cuts it). */
  answer?: string;
  added?: number;
  removed?: number;
  ok?: boolean;
  agent?: string;
  contextPercent?: number;
  tokens?: number;
  costUsd?: number;
};

/** Steps sent in one request, at most; the oldest are dropped past it. */
export const MAX_BATCH = 100;
/** Steps wait this long to go together. */
export const FLUSH_MS = 400;
/** An answer is cut to this before it goes to the app. */
export const MAX_ANSWER = 8000;
/** Commands and descriptions are cut to this before the app masks them. */
const MAX_DETAIL = 300;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const cut = (s: string) => (s.length > MAX_DETAIL ? `${s.slice(0, MAX_DETAIL - 1)}…` : s);
const lines = (s: string) => (s ? s.split("\n").length : 0);

/** The file or pattern a tool works on, and a line about what it does. */
export function describeTool(
  tool: string,
  input: Record<string, unknown>,
): { target: string; detail: string } {
  switch (tool) {
    case "Read":
    case "Edit":
    case "MultiEdit":
    case "Write":
      return { target: str(input.file_path), detail: "" };
    case "NotebookEdit":
    case "NotebookRead":
      return { target: str(input.notebook_path), detail: "" };
    case "Grep":
      return { target: str(input.path), detail: cut(str(input.pattern)) };
    case "Glob":
      return { target: str(input.path), detail: cut(str(input.pattern)) };
    case "Bash":
    case "PowerShell":
      return { target: "", detail: cut(str(input.command)) };
    case "Agent":
    case "Task":
      return {
        target: "",
        detail: cut(str(input.description) || str(input.subagent_type)),
      };
    case "WebFetch":
      return { target: "", detail: cut(str(input.url)) };
    case "WebSearch":
      return { target: "", detail: cut(str(input.query)) };
    default:
      return {
        target: "",
        detail: tool.startsWith("mcp__") ? tool.split("__").slice(1).join(" ") : "",
      };
  }
}

/** Lines an edit adds and removes, from its input (before it runs). */
export function editSize(
  tool: string,
  input: Record<string, unknown>,
): { added: number; removed: number } {
  if (tool === "Edit") {
    return { added: lines(str(input.new_string)), removed: lines(str(input.old_string)) };
  }
  if (tool === "MultiEdit" && Array.isArray(input.edits)) {
    let added = 0;
    let removed = 0;
    for (const e of input.edits as Record<string, unknown>[]) {
      added += lines(str(e?.new_string));
      removed += lines(str(e?.old_string));
    }
    return { added, removed };
  }
  if (tool === "Write") return { added: lines(str(input.content)), removed: 0 };
  return { added: 0, removed: 0 };
}

/** The tool's own arguments: the event without the engine's keys. */
export function toolInput(e: Record<string, unknown>): Record<string, unknown> {
  const { tool: _t, tool_use_id: _i, agentId: _a, requestMeta: _m, ...rest } = e;
  return rest;
}

/** A queue that keeps the newest steps. */
export function enqueue(queue: Step[], step: Step): Step[] {
  const next = [...queue, step];
  return next.length > MAX_BATCH ? next.slice(next.length - MAX_BATCH) : next;
}
