import { invoke, isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";

// Mirrors src-tauri/src/work: the open project's git status, read only.
export interface Head {
  branch: string | null;
  commit: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface Change {
  path: string;
  origPath: string | null;
  kind: string;
  staged: boolean;
  unstaged: boolean;
}

export interface Overview {
  root: string;
  mainRoot: string;
  head: Head;
  operation: string | null;
  changes: Change[];
  changeCount: number;
  hasRemote: boolean;
  /** Commits not on the remote yet. */
  unpushed: number;
}

/** Local git is cheap to read; the home page stays current with it. */
const POLL_MS = 5_000;

interface WorkState {
  project: string | null;
  overview: Overview | null;
  /** The project is not a git repository. */
  notGit: boolean;
  load: (project: string | null) => Promise<void>;
  refresh: () => Promise<void>;
}

let timer: ReturnType<typeof setInterval> | undefined;

export const useWorkStore = create<WorkState>((set, get) => {
  let seq = 0;
  return {
    project: null,
    overview: null,
    notGit: false,

    load: async (project) => {
      if (project !== get().project) set({ project, overview: null, notGit: false });
      clearInterval(timer);
      if (project) {
        timer = setInterval(() => {
          if (document.visibilityState === "visible") void get().refresh();
        }, POLL_MS);
      }
      await get().refresh();
    },

    refresh: async () => {
      const { project } = get();
      if (!project || !isTauri()) return;
      const id = ++seq;
      try {
        const next = await invoke<Overview | null>("work_overview", {
          project,
          countWorktrees: false,
        });
        if (id === seq && get().project === project) set({ overview: next, notGit: !next });
      } catch {
        if (id === seq) set({ overview: null });
      }
    },
  };
});
