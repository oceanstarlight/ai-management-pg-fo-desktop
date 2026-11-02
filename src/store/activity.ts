import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { getPref, onPrefChanged, setPref } from "./prefs";

// Mirrors src-tauri/src/activity.rs: what each Claude Code session is doing.

export type Category =
  | "read"
  | "search"
  | "edit"
  | "run"
  | "agent"
  | "web"
  | "plan"
  | "ask"
  | "mcp"
  | "other";

export type State = Category | "idle" | "thinking" | "ended";

export interface Step {
  at: number;
  kind: "turn" | "tool" | "toolEnd" | "usage";
  id: string;
  phase: string;
  tool: string;
  category: Category | "";
  target: string;
  detail: string;
  /** The end of a turn: Claude's answer. */
  answer: string;
  added: number;
  removed: number;
  ok: boolean | null;
  agent: string | null;
  /** An Agent call's task (to match its subagent). */
  prompt?: string;
}

export interface FileStat {
  reads: number;
  edits: number;
  added: number;
  removed: number;
  lastAt: number;
  last: "read" | "edit";
}

export interface Counters {
  tools: number;
  reads: number;
  edits: number;
  commands: number;
  searches: number;
  agents: number;
  failed: number;
  added: number;
  removed: number;
}

export interface Session {
  session: string;
  project: string;
  surface: string;
  /** The git branch where the session runs ("" when not known yet). */
  branch?: string;
  cloud: boolean;
  state: State;
  doing: string;
  turnStarted: number | null;
  turns: number;
  turn: Counters;
  steps: Step[];
  files: Record<string, FileStat>;
  usage: {
    contextPercent: number | null;
    tokens: number | null;
    costUsd: number | null;
    /** The cost is estimated from token counts (the host keeps no ledger). */
    costEstimated?: boolean;
  };
  at: number;
  /** The last main turn was interrupted, or Claude Code went quiet mid-turn. */
  stoppedAt?: number | null;
}

/** One tool call: its start, and how it ended once it did. */
export interface Call {
  start: Step;
  end: Step | null;
}

/** A turn with its calls, newest first in the timeline. */
export interface Turn {
  id: string;
  prompt: string;
  at: number;
  calls: Call[];
  ended: boolean;
  /** Claude's answer, once the turn ended with one. */
  answer: string;
}

/** Groups a session's steps into turns of calls (oldest first). */
export function turnsOf(steps: Step[]): Turn[] {
  const turns: Turn[] = [];
  const calls = new Map<string, Call>();
  let current: Turn | null = null;
  for (const step of steps) {
    if (step.kind === "turn" && !step.agent) {
      if (step.phase === "start") {
        current = {
          id: step.id,
          prompt: step.detail,
          at: step.at,
          calls: [],
          ended: false,
          answer: "",
        };
        turns.push(current);
      } else if (current) {
        current.ended = true;
        current.answer = step.answer ?? "";
      }
      continue;
    }
    if (step.kind === "tool") {
      if (!current) {
        current = { id: "", prompt: "", at: step.at, calls: [], ended: false, answer: "" };
        turns.push(current);
      }
      const call = { start: step, end: null };
      calls.set(step.id, call);
      current.calls.push(call);
    } else if (step.kind === "toolEnd") {
      const call = calls.get(step.id);
      if (call) call.end = step;
    }
  }
  return turns;
}

/** The session to show: the chosen one, else the busiest recent one. */
export function pickSession(sessions: Session[], chosen: string | null): Session | null {
  const found = chosen ? sessions.find((s) => s.session === chosen) : undefined;
  if (found) return found;
  const live = sessions.filter((s) => s.state !== "ended");
  const pool = live.length ? live : sessions;
  return pool.reduce<Session | null>((a, b) => (!a || b.at > a.at ? b : a), null);
}

/** Which sessions the home page shows: this computer's, or the cloud's. */
export type LiveMode = "local" | "cloud";
const MODE_KEY = "live.mode";

/** Names the user gave sessions, by session id. Kept on this computer only. */
const NAMES_KEY = "live.sessionNames";
const MAX_NAMES = 200;
const MAX_NAME = 80;

function readNames(raw: string | null): Record<string, string> {
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

interface ActivityState {
  sessions: Session[];
  mode: LiveMode;
  setMode: (mode: LiveMode) => void;
  /** The session the user picked; `null` follows the latest. */
  chosen: string | null;
  /** Names the user gave sessions (`rename`), by session id. */
  names: Record<string, string>;
  init: () => void;
  choose: (session: string | null) => void;
  /** Names a session; an empty name goes back to the automatic one. */
  rename: (session: string, name: string) => void;
}

let started = false;

export const useActivityStore = create<ActivityState>((set, get) => ({
  sessions: [],
  mode: getPref(MODE_KEY) === "cloud" ? "cloud" : "local",
  setMode: (mode) => {
    setPref(MODE_KEY, mode);
    set({ mode, chosen: null });
  },
  chosen: null,
  names: readNames(getPref(NAMES_KEY)),

  init: () => {
    if (started) return;
    started = true;
    // Prefs may load after the store was made; the other window renames too.
    set({ names: readNames(getPref(NAMES_KEY)) });
    onPrefChanged(NAMES_KEY, (raw) => set({ names: readNames(raw) }));
    if (!isTauri()) {
      // The browser preview plays a made-up session.
      if (import.meta.env.DEV) {
        void import("./activityDemo").then(({ playDemo }) => {
          playDemo((session) => {
            const rest = get().sessions.filter((s) => s.session !== session.session);
            set({ sessions: [...rest, session] });
          });
        });
      }
      return;
    }
    void invoke<Session[]>("activity_sessions").then((sessions) => set({ sessions }));
    void listen<Session>("session-activity", ({ payload }) => {
      const rest = get().sessions.filter((s) => s.session !== payload.session);
      set({ sessions: [...rest, payload] });
    });
    void listen<{ session: string }>("session-activity-gone", ({ payload }) => {
      set({ sessions: get().sessions.filter((s) => s.session !== payload.session) });
    });
  },

  choose: (chosen) => set({ chosen }),

  rename: (session, name) => {
    const { [session]: _, ...rest } = get().names;
    const trimmed = name.trim().slice(0, MAX_NAME);
    // Newest last; drop the oldest past the limit.
    const entries = Object.entries(trimmed ? { ...rest, [session]: trimmed } : rest);
    const names = Object.fromEntries(entries.slice(-MAX_NAMES));
    setPref(NAMES_KEY, JSON.stringify(names));
    set({ names });
  },
}));
