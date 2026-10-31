import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";

// Mirrors `ModStatus` in src-tauri/src/claude_mod.rs and `Status` in
// src-tauri/src/sync/relay.rs: how Encela reaches Claude Code.

export interface ModStatus {
  claudeVersion: string | null;
  supported: boolean;
  installed: string[];
  ownOutdated: boolean;
}

export interface RelayStatus {
  enabled: boolean;
  token: string | null;
  state: "off" | "needsSignIn" | "ok" | "error";
  message: string | null;
  /** Epoch milliseconds of the last prompt or answer received. */
  lastEvent: number | null;
}

/** The app's own mod, as Claude Code names it. */
export const OWN_MOD = "branch-notes@ai-management";

interface ConnectionState {
  mod: ModStatus | null;
  relay: RelayStatus | null;
  load: () => Promise<void>;
  loadMod: () => Promise<void>;
  installMod: () => Promise<void>;
  setRelay: (enabled: boolean) => Promise<void>;
}

let listening = false;

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  mod: null,
  relay: null,

  load: async () => {
    if (!isTauri()) return;
    if (!listening) {
      listening = true;
      void listen<RelayStatus>("relay-status", (e) => set({ relay: e.payload }));
    }
    await Promise.all([
      get().loadMod(),
      invoke<RelayStatus>("relay_status").then((relay) => set({ relay })),
    ]);
  },

  loadMod: async () => {
    if (!isTauri()) return;
    set({ mod: await invoke<ModStatus>("claude_mod_status").catch(() => null) });
  },

  installMod: async () => {
    try {
      await invoke("claude_mod_install");
    } finally {
      await get().loadMod();
    }
  },

  setRelay: async (enabled) => {
    set({ relay: await invoke<RelayStatus>("relay_set_enabled", { enabled }) });
  },
}));

/** The mod is installed and current. */
export const modReady = (mod: ModStatus | null) =>
  !!mod && mod.installed.includes(OWN_MOD) && !mod.ownOutdated;
