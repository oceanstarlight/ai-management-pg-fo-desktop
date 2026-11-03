import { invoke, isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { McpConfig, McpScope } from "./mcp";

// Mirrors src-tauri/src/mcp_hub/mod.rs.
export interface HubTool {
  name: string;
  description: string;
}

export interface HubEntry {
  name: string;
  description: string;
  tags: string[];
  config: McpConfig;
  /** Offered through the hub server (encela-hub). */
  inHub: boolean;
  /** Tools the last check found. */
  tools: HubTool[];
  checkedAt: number | null;
}

/** Whether Claude Code has the hub server (`claude mcp get encela-hub`). */
export interface HubServerStatus {
  claudeFound: boolean;
  registered: boolean;
  current: boolean;
}

/** The hub can start stdio and HTTP servers; others only go into projects. */
export const hubCanRun = (config: McpConfig) =>
  config.transport === "stdio" || config.transport === "http";

interface HubState {
  entries: HubEntry[];
  loaded: boolean;
  error: string | null;
  /** Names being checked right now, and what a check last said. */
  checking: string[];
  checkErrors: Record<string, string>;
  server: HubServerStatus | null;
  load: () => Promise<void>;
  /** Adds, or replaces the entry named `original`. Throws on refusal. */
  save: (original: string | null, entry: HubEntry) => Promise<void>;
  remove: (name: string) => Promise<void>;
  setInHub: (entry: HubEntry, inHub: boolean) => Promise<void>;
  check: (name: string, project: string | null) => Promise<void>;
  /** Puts the entry into `project`; throws on refusal. */
  apply: (project: string, name: string, scope: McpScope) => Promise<void>;
  loadServer: () => Promise<void>;
  connectServer: () => Promise<void>;
  disconnectServer: () => Promise<void>;
  dismissError: () => void;
}

export const useHubStore = create<HubState>((set, get) => ({
  entries: [],
  loaded: false,
  error: null,
  checking: [],
  checkErrors: {},
  server: null,

  load: async () => {
    if (!isTauri()) return;
    try {
      set({ entries: await invoke<HubEntry[]>("hub_list"), loaded: true });
    } catch (e) {
      set({ error: String(e), loaded: true });
    }
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
