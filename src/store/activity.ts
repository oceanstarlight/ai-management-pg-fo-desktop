import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { getPref, setPref } from "./prefs";

// Mirrors src-tauri/src/activity.rs: what each Claude Code session is doing.

export type Category =
  | "read"
  | "search"
  | "edit"
  | "run"
  | "agent"
  | "web"
  | "plan"
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
  usage: { contextPercent: number | null; tokens: number | null; costUsd: number | null };
  at: number;
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

interface ActivityState {
  sessions: Session[];
  mode: LiveMode;
  setMode: (mode: LiveMode) => void;
  /** The session the user picked; `null` follows the latest. */
  chosen: string | null;
  /** Each project's files for the map. */
  files: Record<string, string[]>;
  init: () => void;
  choose: (session: string | null) => void;
  loadFiles: (project: string, force?: boolean) => Promise<void>;
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
  files: {},

  init: () => {
    if (started) return;
    started = true;
    if (!isTauri()) {
      // The browser preview plays a made-up session.
      if (import.meta.env.DEV) {
        void import("./activityDemo").then(({ playDemo, DEMO_FILES, DEMO_PROJECT }) => {
          set({ files: { ...get().files, [DEMO_PROJECT]: DEMO_FILES } });
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
      // A file the session made shows on the map.
      const project = payload.project;
      const last = payload.steps[payload.steps.length - 1];
      if (
        project &&
        last?.kind === "toolEnd" &&
        last.category === "edit" &&
        last.target &&
        get().files[project] &&
        !get().files[project]?.includes(last.target)
      ) {
        set({
          files: { ...get().files, [project]: [...(get().files[project] ?? []), last.target] },
        });
      }
    });
    void listen<{ session: string }>("session-activity-gone", ({ payload }) => {
      set({ sessions: get().sessions.filter((s) => s.session !== payload.session) });
    });
  },

  choose: (chosen) => set({ chosen }),

  loadFiles: async (project, force = false) => {
    if (!isTauri() || (!force && get().files[project])) return;
    try {
      const list = await invoke<string[]>("activity_files", { project });
      set({ files: { ...get().files, [project]: list } });
    } catch {
      set({ files: { ...get().files, [project]: [] } });
    }
  },
}));
