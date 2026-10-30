import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { create } from "zustand";
import {
  AI_SYSTEM,
  aiAsk,
  aiCatalog,
  type Candidate,
  decisionsFor,
  keywordRank,
  label,
  MAX_ITEMS,
  parseAiReply,
  wantsSuggestions,
} from "../../claude-mod/branch-notes/hooks/suggest";
import { useLocaleStore } from "../i18n";
import { getPref, onPrefChanged, setPref } from "./prefs";
import { useProjectStore } from "./project";
import { candidatesFor } from "./suggest";

// Mirrors src-tauri/src/suggest (live sessions) and src-tauri/src/decisions.rs.

export interface LiveItem {
  key: string;
  name: string;
  kind: string;
  source: string;
  label: string;
  description: string;
}

/** The prompt being written in one Claude Code session. */
export interface Live {
  session: string;
  project: string;
  surface: string;
  draft: string;
  by: string;
  pending: boolean;
  items: LiveItem[];
  picked: string[];
  at: number;
}

export interface Decision {
  id: string;
  topic: string;
  value: string;
  /** `auto` (found in Claude's answer) or `user`. */
  source: string;
  at: number;
  inClaudeMd: boolean;
}

export type LiveCommand =
  | { op: "pick"; key: string }
  | { op: "fill"; text: string }
  | { op: "refine" }
  | { op: "undo" };

/** Suggestions are used without asking (`on`). */
export const AUTO_PREF = "suggestAuto";
/** The app turns into the sidebar when Claude starts unless `off`. */
export const AUTO_DOCK_PREF = "autoDockClaude";

interface LiveState {
  sessions: Live[];
  decisions: Decision[];
  /** The project `decisions` belong to. */
  decisionsFor: string | null;
  init: () => void;
  send: (session: string, command: LiveCommand) => Promise<void>;
  loadDecisions: (project: string | null) => Promise<void>;
  saveDecisions: (project: string, list: Decision[]) => Promise<void>;
  /** Writes them into the project's CLAUDE.md; returns the file. */
  applyDecisions: (project: string) => Promise<string>;
}

let started = false;

/** A local folder rather than a cloud session's `owner/repo`. */
const isLocalPath = (p: string) => /^([a-zA-Z]:[\\/]|\/)/.test(p);

/**
 * Picks suggestions for a prompt sent in a cloud session (sync/relay.rs),
 * with the mod's own matching. Only the window that claims it asks Haiku.
 */
async function pickForCloud(session: string) {
  const claim = await invoke<{ id: number; project: string; draft: string } | null>(
    "suggest_cloud_claim",
    { session },
  );
  if (!claim) return;
  let items: Candidate[] = [];
  let by = "keyword";
  try {
    const local = isLocalPath(claim.project) ? claim.project : null;
    const { catalog, candidates } = await candidatesFor(local);
    const mode = catalog.mode ?? "ai";
    if (mode !== "off" && wantsSuggestions(claim.draft)) {
      items = keywordRank(claim.draft, candidates, MAX_ITEMS);
      if (mode === "ai") {
        const reply = await invoke<string>("suggest_ai", {
          project: local,
          system: AI_SYSTEM,
          prompt: `${aiCatalog(candidates)}\n\n${aiAsk(claim.draft, decisionsFor(catalog, claim.project))}`,
        }).catch(() => null);
        if (reply !== null) {
          items = parseAiReply(reply, candidates);
          by = "ai";
        }
      }
    }
  } catch {
    // Shown with no suggestions rather than left pending.
  }
  const locale = useLocaleStore.getState().locale;
  await invoke("suggest_cloud_items", {
    session,
    id: claim.id,
    by,
    items: items.map((c) => ({
      key: c.key,
      name: c.name,
      kind: c.kind,
      source: c.source,
      label: label(c, locale),
      description: c.description ?? "",
    })),
  });
}

function pickCloudPrompts(sessions: Live[]) {
  for (const s of sessions) {
    if (s.surface === "cloud" && s.pending) void pickForCloud(s.session);
  }
}

export const useLiveStore = create<LiveState>((set, get) => ({
  sessions: [],
  decisions: [],
  decisionsFor: null,

  init: () => {
    if (started || !isTauri()) return;
    started = true;
    void invoke<Live[]>("suggest_live").then((sessions) => {
      set({ sessions });
      pickCloudPrompts(sessions);
    });
    void listen<Live[]>("suggest-live", (e) => {
      set({ sessions: e.payload });
      pickCloudPrompts(e.payload);
    });
    void listen<{ project: string }>("decisions-changed", (e) => {
      if (e.payload.project === get().decisionsFor) void get().loadDecisions(e.payload.project);
    });
    // A Claude Code session started: work on its project.
    void listen<{ project: string }>("claude-session", (e) => {
      const { project } = e.payload;
      if (project && project !== useProjectStore.getState().current) {
        void useProjectStore.getState().select(project);
      }
    });
  },

  send: async (session, command) => {
    await invoke("suggest_send", { session, command });
  },

  loadDecisions: async (project) => {
    if (!project || !isTauri()) {
      set({ decisions: [], decisionsFor: project });
      return;
    }
    const decisions = await invoke<Decision[]>("decisions_list", { project });
    set({ decisions, decisionsFor: project });
  },

  saveDecisions: async (project, list) => {
    const decisions = await invoke<Decision[]>("decisions_save", { project, decisions: list });
    set({ decisions, decisionsFor: project });
  },

  applyDecisions: async (project) => {
    const file = await invoke<string>("decisions_apply", { project });
    await get().loadDecisions(project);
    return file;
  },
}));

/** An on/off preference as React state (`on` / `off`, or the default). */
export function useSwitchPref(key: string, fallback: boolean): [boolean, (on: boolean) => void] {
  const read = () => {
    const v = getPref(key);
    return v === null ? fallback : v === "on";
  };
  const [value, setValue] = useState(read);
  // biome-ignore lint/correctness/useExhaustiveDependencies: read only uses key and fallback
  useEffect(() => onPrefChanged(key, () => setValue(read())), [key, fallback]);
  return [
    value,
    (on) => {
      setValue(on);
      setPref(key, on ? "on" : "off");
    },
  ];
}
