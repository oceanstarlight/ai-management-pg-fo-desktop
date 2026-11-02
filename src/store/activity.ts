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

/**
 * With "stay on one session" on: the pinned session while it lasts. It gives
 * way when it is gone, or when it ended and another one is still going; then
 * `fallback` picks the next one, which gets pinned in turn.
 */
export function stickySession(
  pool: Session[],
  chosen: string | null,
  fallback: (pool: Session[]) => Session | null,
): Session | null {
  const found = chosen ? pool.find((s) => s.session === chosen) : undefined;
  if (found && (found.state !== "ended" || pool.every((s) => s.state === "ended"))) return found;
  return fallback(pool);
}

/** Which sessions the home page shows: this computer's, or the cloud's. */
export type LiveMode = "local" | "cloud";
const MODE_KEY = "live.mode";
/** "on": stay on one session instead of following the latest. */
export const STICK_KEY = "live.stick";

interface ActivityState {
  sessions: Session[];
  mode: LiveMode;
  setMode: (mode: LiveMode) => void;
  /** The session the user picked; `null` follows the latest. */
  chosen: string | null;
  init: () => void;
  choose: (session: string | null) => void;
  /** Stay on the shown session instead of following whichever acted last. */
  stick: boolean;
  setStick: (on: boolean) => void;
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
  stick: getPref(STICK_KEY) === "on",
  setStick: (stick) => {
    setPref(STICK_KEY, stick ? "on" : "off");
    // Off again: follow the latest right away.
    set(stick ? { stick } : { stick, chosen: null });
  },

  init: () => {
    if (started) return;
    started = true;
    set({ stick: getPref(STICK_KEY) === "on" });
    onPrefChanged(STICK_KEY, (v) => set({ stick: v === "on" }));
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
}));
