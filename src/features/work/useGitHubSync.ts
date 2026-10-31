import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect } from "react";
import { useGitHubStore } from "../../store/github";
import { useNotifyStore } from "../../store/notify";
import { useProjectStore } from "../../store/project";
import { useWorkStore } from "../../store/work";

/** GitHub is polled far less often than local git (5,000 requests an hour). */
const POLL_MS = 60_000;

export const open = (url: string) => {
  if (isTauri()) void openUrl(url);
  else window.open(url, "_blank");
};

/**
 * Keeps the open project's git status and its GitHub PR and checks current:
 * on project, sign-in, branch and push changes, and every minute while the
 * window is shown. Called once per window (main and sidebar).
 */
export function useGitHubSync() {
  const project = useProjectStore((s) => s.current);
  const overview = useWorkStore((s) => s.overview);
  const { status, init, load } = useGitHubStore();
  const signedIn = !!status?.account;
  const branch = overview?.head.branch ?? null;
  const commit = overview?.head.commit ?? null;
  const unpushed = overview?.unpushed ?? 0;

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    void useWorkStore.getState().load(project);
  }, [project]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: branch, commit and unpushed are reload triggers
  useEffect(() => {
    void load(project);
  }, [project, signedIn, branch, commit, unpushed, load]);

  useEffect(() => {
    const tick = () => {
      // Hidden, keep watching an open PR so its merge or CI result is notified.
      const { view, project } = useGitHubStore.getState();
      const watching = useNotifyStore.getState().on && view?.current?.state === "open";
      if (document.visibilityState === "visible" || watching) void load(project);
    };
    const timer = setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [load]);
}
