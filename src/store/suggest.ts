import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import {
  AI_DELAY_MS,
  AI_SYSTEM,
  aiAsk,
  aiCatalog,
  buildCandidates,
  type Candidate,
  installedCandidate,
  keywordRank,
  label,
  MAX_ITEMS,
  NEW_AUTOMATION,
  parseAiReply,
  type SuggestExport,
  type SuggestMode,
  wantsSuggestions,
} from "../../claude-mod/branch-notes/hooks/suggest";

// Mirrors src-tauri/src/suggest. The matching is the Claude Code mod's own
// code, so the app's prompt box suggests what the terminal would.

export interface LogItem {
  key: string;
  name: string;
  kind: string;
  source: string;
}

export interface LogEntry {
  id: string;
  /** Epoch milliseconds. */
  at: number;
  project: string;
  draft: string;
  by: string;
  items: LogItem[];
  picked: string[];
}

export interface Top extends LogItem {
  shown: number;
  picked: number;
}

interface Overview {
  mode: SuggestMode;
  log: LogEntry[];
  top: Top[];
  prompts: number;
  picked: number;
}

interface LoadedFile {
  kind: "skill" | "agent" | "command";
  name: string;
  plugin: string | null;
  text: string;
}

interface Candidates {
  catalog: SuggestExport;
  files: LoadedFile[];
}

/** A logged item's name; the new-automation entry in the reader's words. */
export function itemName(item: LogItem, locale: "ko" | "en"): string {
  return item.key === NEW_AUTOMATION
    ? label({ ...item, kind: "automation", source: "automation", description: "" }, locale)
    : item.name;
}

const EMPTY: Overview = { mode: "ai", log: [], top: [], prompts: 0, picked: 0 };

interface SuggestState {
  overview: Overview;
  candidates: Candidate[];
  catalog: SuggestExport | null;
  /** The project the candidates were read for. */
  project: string | null;
  draft: string;
  items: Candidate[];
  by: "keyword" | "ai";
  /** Haiku is picking. */
  pending: boolean;
  error: string | null;
  loadOverview: () => Promise<void>;
  loadCandidates: (project: string | null) => Promise<void>;
  setDraft: (draft: string) => void;
  clearLog: () => Promise<void>;
}

let listening = false;
let timer: ReturnType<typeof setTimeout> | undefined;
/** Bumped on every draft, so a late Haiku reply for an old one is dropped. */
let asked = 0;

export const useSuggestStore = create<SuggestState>((set, get) => {
  const askHaiku = async (draft: string, id: number) => {
    const { candidates, project } = get();
    try {
      const reply = await invoke<string>("suggest_ai", {
        project,
        system: AI_SYSTEM,
        prompt: `${aiCatalog(candidates)}\n\n${aiAsk(draft)}`,
      });
      if (id !== asked) return;
      set({ items: parseAiReply(reply, candidates), by: "ai", pending: false });
    } catch (e) {
      if (id !== asked) return;
      set({ pending: false, error: String(e) });
    }
  };

  return {
    overview: EMPTY,
    candidates: [],
    catalog: null,
    project: null,
    draft: "",
    items: [],
    by: "keyword",
    pending: false,
    error: null,

    loadOverview: async () => {
      if (!isTauri()) return;
      if (!listening) {
        listening = true;
        void listen("suggest-log-changed", () => void get().loadOverview());
        void listen("automations-changed", () => void get().loadCandidates(get().project));
      }
      set({ overview: await invoke<Overview>("suggest_overview") });
    },

    loadCandidates: async (project) => {
      if (!isTauri()) return;
      const c = await invoke<Candidates>("suggest_candidates", { project });
      const installed = c.files
        .map((f) => installedCandidate(f.kind, f.name, f.text, f.plugin ?? undefined))
        .filter((x): x is Candidate => x !== null);
      set({ project, catalog: c.catalog, candidates: buildCandidates(installed, c.catalog) });
      const { draft } = get();
      if (draft) get().setDraft(draft);
    },

    setDraft: (draft) => {
      clearTimeout(timer);
      const id = ++asked;
      const mode = get().catalog?.mode ?? get().overview.mode;
      if (mode === "off" || !wantsSuggestions(draft)) {
        set({ draft, items: [], pending: false, error: null });
        return;
      }
      const items = keywordRank(draft, get().candidates, MAX_ITEMS);
      const ai = mode === "ai" && isTauri();
      set({ draft, items, by: "keyword", pending: ai, error: null });
      if (ai) timer = setTimeout(() => void askHaiku(draft, id), AI_DELAY_MS);
    },

    clearLog: async () => {
      await invoke("suggest_log_clear");
      await get().loadOverview();
    },
  };
});
