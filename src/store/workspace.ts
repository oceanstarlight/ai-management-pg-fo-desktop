import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { create } from "zustand";
import { getPref, setPref } from "./prefs";
import { switchView } from "./view";

export type Page = "home" | "tools" | "project" | "automations" | "memo" | "settings";

/** The settings section with the Claude connection, to scroll to. */
export const CONNECT_SECTION = "connect";

const COLLAPSED_KEY = "nav-collapsed";
/** A page the main window opens on once (set by the sidebar). */
const OPEN_PAGE_KEY = "openPage";
/** Set once the connection page was shown on first launch. */
const CONNECT_SEEN_KEY = "connectSeen";

/** Scrolls the open page to a section once it is drawn. */
export function scrollToSection(id: string) {
  setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 60);
}

const PAGES: Page[] = ["home", "tools", "project", "automations", "memo", "settings"];
const PROJECT_TABS: ProjectTab[] = ["docs", "map", "decisions", "starters"];

/**
 * The first page: the connection settings when asked or on first launch, a
 * page the sidebar asked for (`settings`, `project:starters`...), else home.
 */
function firstPage(): { page: Page; projectTab: ProjectTab } {
  const asked = getPref(OPEN_PAGE_KEY);
  const connect = asked === "connect" || getPref(CONNECT_SEEN_KEY) === null;
  setPref(OPEN_PAGE_KEY, null);
  setPref(CONNECT_SEEN_KEY, "1");
  if (connect) {
    scrollToSection(CONNECT_SECTION);
    return { page: "settings", projectTab: "docs" };
  }
  const [page, tab] = (asked ?? "").split(":") as [Page, ProjectTab | undefined];
  return {
    page: PAGES.includes(page) ? page : "home",
    projectTab: tab && PROJECT_TABS.includes(tab) ? tab : "docs",
  };
}

const inSidebar = () => isTauri() && getCurrentWebviewWindow().label === "sidebar";

/** From the sidebar: opens the main window on `page` (made anew, it reads this when it starts). */
async function openInMain(page: string) {
  await invoke("prefs_set", { key: OPEN_PAGE_KEY, value: page }).catch(() => {});
  setPref(OPEN_PAGE_KEY, page);
  await switchView("main");
}

function readCollapsed(): boolean {
  try {
    return getPref(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export type ToolsTab = "library" | "mcp" | "extensions" | "catalog";
export type ProjectTab = "docs" | "map" | "decisions" | "starters";

interface WorkspaceState {
  page: Page;
  toolsTab: ToolsTab;
  projectTab: ProjectTab;
  setToolsTab: (tab: ToolsTab) => void;
  /** Opens the project page on a tab. */
  goProject: (tab: ProjectTab) => void;
  /** The left navigation shows icons only. */
  collapsed: boolean;
  go: (page: Page) => void;
  toggleCollapsed: () => void;
}

const first = firstPage();

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  page: first.page,
  toolsTab: "library",
  projectTab: first.projectTab,
  setToolsTab: (toolsTab) => set({ toolsTab }),
  goProject: (projectTab) => {
    if (inSidebar()) void openInMain(`project:${projectTab}`);
    else set({ page: "project", projectTab });
  },
  collapsed: readCollapsed(),
  go: (page) => {
    if (inSidebar()) void openInMain(page);
    else set({ page });
  },
  toggleCollapsed: () => {
    const collapsed = !get().collapsed;
    setPref(COLLAPSED_KEY, collapsed ? "1" : "0");
    set({ collapsed });
  },
}));

/** Opens the Claude connection page, switching from the sidebar if need be. */
export async function openConnect() {
  if (!inSidebar()) {
    useWorkspaceStore.getState().go("settings");
    scrollToSection(CONNECT_SECTION);
    return;
  }
  await openInMain("connect");
}
