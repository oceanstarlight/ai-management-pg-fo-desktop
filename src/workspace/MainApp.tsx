import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { AccountDialog } from "../features/account/AccountDialog";
import { useGitHubSync } from "../features/work/useGitHubSync";
import { useAccountStore } from "../store/account";
import { useActivityStore } from "../store/activity";
import { useAutomationStore } from "../store/automation";
import { subscribeDockStatus } from "../store/dock";
import { useLiveStore } from "../store/live";
import { restoreProject } from "../store/project";
import { useSyncStore } from "../store/sync";
import { startUpdateChecks } from "../store/updater";
import { type Page, useWorkspaceStore } from "../store/workspace";
import { saveBeforeLeaving } from "./leave";
import { NavSidebar } from "./NavSidebar";
import { AutomationsPage } from "./pages/AutomationsPage";
import { HomePage } from "./pages/HomePage";
import { MemoPage } from "./pages/MemoPage";
import { ProjectPage } from "./pages/ProjectPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ToolsPage } from "./pages/ToolsPage";

const PAGES: Record<Page, () => React.ReactNode> = {
  home: () => <HomePage />,
  project: () => <ProjectPage />,
  tools: () => <ToolsPage />,
  automations: () => <AutomationsPage />,
  memo: () => <MemoPage />,
  settings: () => <SettingsPage />,
};

export default function MainApp() {
  // PR and CI state for the open project, and notifications, whatever page is shown.
  useGitHubSync();
  const page = useWorkspaceStore((s) => s.page);

  // The project selected last, and what Claude Code is doing.
  useEffect(() => {
    restoreProject();
    useActivityStore.getState().init();
    void useSyncStore.getState().init();
    void useAccountStore.getState().init();
    startUpdateChecks();
    useLiveStore.getState().init();
  }, []);

  // The window is destroyed on close (also when switching to the sidebar from
  // the tray or shortcut); save the open note first.
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = getCurrentWindow().onCloseRequested(() => saveBeforeLeaving());
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  // "Make this an automation", picked in Claude Code.
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen<{ prompt: string; project: string }>("automation-draft", (e) => {
      useAutomationStore.getState().startDraft(e.payload.prompt, e.payload.project);
      useWorkspaceStore.getState().go("automations");
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  // Settings show and change the sidebar's docking state.
  useEffect(() => {
    const unsubscribe = subscribeDockStatus();
    return () => {
      void unsubscribe.then((stop) => stop());
    };
  }, []);

  return (
    <div className="flex h-full">
      <NavSidebar />
      <main
        className={`min-w-0 flex-1 bg-surface ${page === "home" ? "overflow-hidden" : "overflow-y-auto"}`}
      >
        <ErrorBoundary resetKey={page}>{PAGES[page]()}</ErrorBoundary>
      </main>
      <AccountDialog />
    </div>
  );
}
