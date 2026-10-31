import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { create } from "zustand";
import { getPref, setPref } from "./prefs";
import { switchView } from "./view";

export type Page =
  | "home"
  | "connect"
  | "composer"
  | "library"
  | "config"
  | "files"
  | "mcp"
  | "commands"
  | "work"
  | "trees"
  | "memo"
  | "automations"
  | "settings";

const COLLAPSED_KEY = "nav-collapsed";
/** A page the main window opens on once (set by the sidebar). */
const OPEN_PAGE_KEY = "openPage";
/** Set once the connection page was shown on first launch. */
const CONNECT_SEEN_KEY = "connectSeen";

/** The first page: one asked for, the connection page on first launch, else home. */
function firstPage(): Page {
  if (getPref(OPEN_PAGE_KEY) === "connect") {
    setPref(OPEN_PAGE_KEY, null);
    return "connect";
  }
  if (getPref(CONNECT_SEEN_KEY) === null) {
    setPref(CONNECT_SEEN_KEY, "1");
    return "connect";
  }
  return "home";
}

function readCollapsed(): boolean {
  try {
    return getPref(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

interface WorkspaceState {
  page: Page;
  /** The left navigation shows icons only. */
  collapsed: boolean;
  go: (page: Page) => void;
  toggleCollapsed: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  page: firstPage(),
  collapsed: readCollapsed(),
  go: (page) => set({ page }),
  toggleCollapsed: () => {
    const collapsed = !get().collapsed;
    setPref(COLLAPSED_KEY, collapsed ? "1" : "0");
    set({ collapsed });
  },
}));

/** Opens the Claude connection page, switching from the sidebar if need be. */
export async function openConnect() {
  const label = isTauri() ? getCurrentWebviewWindow().label : "main";
  if (label !== "sidebar") {
    useWorkspaceStore.getState().go("connect");
    return;
  }
  // The main window is made anew and reads this when it starts.
  await invoke("prefs_set", { key: OPEN_PAGE_KEY, value: "connect" }).catch(() => {});
  setPref(OPEN_PAGE_KEY, "connect");
  await switchView("main");
}
