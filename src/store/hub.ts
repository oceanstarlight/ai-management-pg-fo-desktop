import { invoke, isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { McpConfig, McpScope } from "./mcp";

// Mirrors src-tauri/src/mcp_hub/.
export interface HubTool {
  name: string;
  description: string;
}

export type ModuleKind = "mcp" | "cli" | "library";

export interface ModuleSource {
  repo: string;
  commit: string;
  license: string | null;
  licenseOk: boolean;
}

/** A module: an MCP server, CLI or library kept without installing it. */
export interface HubEntry {
  name: string;
  description: string;
  tags: string[];
  kind: ModuleKind;
  config: McpConfig;
  /** Offered through the hub server (encela-hub). */
  inHub: boolean;
  /** Tools the last check found. */
  tools: HubTool[];
  checkedAt: number | null;
  source: ModuleSource | null;
  /** How Claude uses it (Markdown). */
  guide: string;
  capabilities: string[];
  inputs: string[];
  outputs: string[];
  /** Setup commands run in the clone (only with the user's go-ahead). */
  install: string[];
  installedDir: string | null;
  warnings: string[];
}

export interface Member {
  module: string;
  role: string;
}

export interface Fit {
  score: number;
  reasons: string[];
  by: "rule" | "ai";
  at: number;
}

export interface Combo {
  name: string;
  goal: string;
  members: Member[];
  aiFit: Fit | null;
}

export interface ComboView extends Combo {
  /** Worked out from the modules now. */
  ruleFit: Fit;
}

export interface CatalogModule {
  id: string;
  needs: string;
  module: HubEntry;
}

export interface Analysis {
  module: HubEntry;
  files: string[];
  needsBuild: boolean;
}

/** Whether Claude Code has the hub server (`claude mcp get encela-hub`). */
export interface HubServerStatus {
  claudeFound: boolean;
  registered: boolean;
  current: boolean;
  /** The npm package's `encela` plugin is installed: it has its own hub. */
  plugin: boolean;
}

/** The hub can start stdio and HTTP servers, and hand out any CLI or library guide. */
export const hubCanRun = (m: Pick<HubEntry, "kind" | "config">) =>
  m.kind !== "mcp" || m.config.transport === "stdio" || m.config.transport === "http";

/** Haiku's fit when there is one, else the worked-out one. */
export const fitOf = (c: ComboView): Fit => c.aiFit ?? c.ruleFit;

export const emptyModule = (p?: Partial<HubEntry>): HubEntry => ({
  name: "",
  description: "",
  tags: [],
  kind: "mcp",
  config: { transport: "stdio", command: "", args: [], env: {}, url: "", headers: {} },
  inHub: true,
  tools: [],
  checkedAt: null,
  source: null,
  guide: "",
  capabilities: [],
  inputs: [],
  outputs: [],
  install: [],
  installedDir: null,
  warnings: [],
  ...p,
});

interface HubState {
  entries: HubEntry[];
  combos: ComboView[];
  catalog: CatalogModule[];
  loaded: boolean;
  error: string | null;
  /** Modules being checked right now, and what a check last said. */
  checking: string[];
  checkErrors: Record<string, string>;
  /** Combinations Haiku is judging. */
  fitting: string[];
  server: HubServerStatus | null;
  load: () => Promise<void>;
  loadCatalog: () => Promise<void>;
  /** Adds, or replaces the module named `original`. Throws on refusal. */
  save: (original: string | null, entry: HubEntry) => Promise<void>;
  remove: (name: string) => Promise<void>;
  setInHub: (entry: HubEntry, inHub: boolean) => Promise<void>;
  check: (name: string, project: string | null) => Promise<void>;
  /** Puts the module into `project`; throws on refusal. */
  apply: (project: string, name: string, scope: McpScope) => Promise<void>;
  /** Reads a GitHub repository and drafts a module (nothing runs). */
  analyze: (repo: string, project: string | null) => Promise<Analysis>;
  /** Clones and runs the approved setup commands; the log. Throws on failure. */
  install: (name: string, steps: string[]) => Promise<string>;
  saveCombo: (original: string | null, combo: Combo) => Promise<void>;
  removeCombo: (name: string) => Promise<void>;
  judgeCombo: (name: string) => Promise<void>;
  loadServer: () => Promise<void>;
  connectServer: () => Promise<void>;
  disconnectServer: () => Promise<void>;
  dismissError: () => void;
}

export const useHubStore = create<HubState>((set, get) => ({
  entries: [],
  combos: [],
  catalog: [],
  loaded: false,
  error: null,
  checking: [],
  checkErrors: {},
  fitting: [],
  server: null,

  load: async () => {
    if (!isTauri()) return;
    try {
      const listing = await invoke<{ modules: HubEntry[]; combos: ComboView[] }>("hub_list");
      set({ entries: listing.modules, combos: listing.combos, loaded: true });
    } catch (e) {
      set({ error: String(e), loaded: true });
    }
  },

  loadCatalog: async () => {
    if (!isTauri() || get().catalog.length) return;
    set({ catalog: await invoke<CatalogModule[]>("module_catalog") });
  },

  save: async (original, entry) => {
    await invoke("hub_save", { original, entry });
    await get().load();
  },

  remove: async (name) => {
    try {
      await invoke("hub_remove", { name });
    } catch (e) {
      set({ error: String(e) });
    }
    await get().load();
  },

  setInHub: async (entry, inHub) => {
    try {
      await invoke("hub_save", { original: entry.name, entry: { ...entry, inHub } });
    } catch (e) {
      set({ error: String(e) });
    }
    await get().load();
  },

  check: async (name, project) => {
    const { [name]: _, ...rest } = get().checkErrors;
    set({ checking: [...get().checking, name], checkErrors: rest });
    try {
      await invoke("hub_check", { name, project });
    } catch (e) {
      set({ checkErrors: { ...get().checkErrors, [name]: String(e) } });
    }
    set({ checking: get().checking.filter((n) => n !== name) });
    await get().load();
  },

  apply: async (project, name, scope) => {
    await invoke("hub_apply", { project, name, scope });
  },

  analyze: (repo, project) => invoke<Analysis>("module_analyze", { repo, project }),

  install: async (name, steps) => {
    try {
      const done = await invoke<{ dir: string; log: string }>("module_install", { name, steps });
      return done.log;
    } finally {
      await get().load();
    }
  },

  saveCombo: async (original, combo) => {
    await invoke("hub_combo_save", { original, combo });
    await get().load();
  },

  removeCombo: async (name) => {
    try {
      await invoke("hub_combo_remove", { name });
    } catch (e) {
      set({ error: String(e) });
    }
    await get().load();
  },

  judgeCombo: async (name) => {
    set({ fitting: [...get().fitting, name] });
    try {
      await invoke("hub_combo_fit", { name });
    } catch (e) {
      set({ error: String(e) });
    }
    set({ fitting: get().fitting.filter((n) => n !== name) });
    await get().load();
  },

  loadServer: async () => {
    if (!isTauri()) return;
    set({ server: await invoke<HubServerStatus>("hub_server_status") });
  },

  connectServer: async () => {
    try {
      await invoke("hub_server_connect");
    } catch (e) {
      set({ error: String(e) });
    }
    await get().loadServer();
  },

  disconnectServer: async () => {
    try {
      await invoke("hub_server_disconnect");
    } catch (e) {
      set({ error: String(e) });
    }
    await get().loadServer();
  },

  dismissError: () => set({ error: null }),
}));
