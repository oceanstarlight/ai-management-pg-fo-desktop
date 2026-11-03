import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { AdaptiveSidebar } from "../features/adaptive/AdaptiveSidebar";
import { DocsTab } from "../features/docs/DocsTab";
import { LiveView } from "../features/live/LiveView";
import { RepoLine } from "../features/live/RepoLine";
import { SidebarSessionPicker } from "../features/live/SessionPicker";
import { MemoPanel } from "../features/memo/MemoPanel";
import { DecisionsPanel } from "../features/suggest/DecisionsPanel";
import { LivePanel } from "../features/suggest/LivePanel";
import { StarterPanel, useNewProject } from "../features/suggest/StarterPanel";
import { SuggestBox } from "../features/suggest/SuggestBox";
import { SuggestFeed } from "../features/suggest/SuggestFeed";
import { SyncNotice } from "../features/sync/SyncNotice";
import { UpdateNotice } from "../features/update/UpdateNotice";
import { useGitHubSync } from "../features/work/useGitHubSync";
import { useActivityStore } from "../store/activity";
import { subscribeDockStatus, useDockStore } from "../store/dock";
import { useLibraryStore } from "../store/library";
import { useLiveStore } from "../store/live";
import { restoreProject, useProjectStore } from "../store/project";
import { useSuggestStore } from "../store/suggest";
import { useSyncStore } from "../store/sync";
import { useUiStore } from "../store/ui";
import { startUpdateChecks } from "../store/updater";
import type { ViewMode } from "../store/view";
import { StatusBar } from "./StatusBar";
import { TabNav } from "./TabNav";
import { TitleBar } from "./TitleBar";

export default function SidebarApp() {
  // PR and CI state for the open project, and notifications, whatever page is shown.
  useGitHubSync();
  const activeTab = useUiStore((s) => s.activeTab);
  // Compact (360px) shows the essentials; wide (560px) adds the work graph
  // and the prompt box with its suggestions and starter forms.
  const wide = useDockStore((s) => s.status?.wide ?? false);
  const fresh = useNewProject();
  const setDraft = useSuggestStore((s) => s.setDraft);

  useEffect(() => {
    const unsubscribe = subscribeDockStatus();
    return () => {
      void unsubscribe.then((stop) => stop());
    };
  }, []);

  // The sidebar stays loaded while the main window is used; catch up with what
  // changed there whenever it becomes the visible window again.
  useEffect(() => {
    restoreProject();
    useActivityStore.getState().init();
    void useSyncStore.getState().init();
    startUpdateChecks();
    useLiveStore.getState().init();
    if (!isTauri()) return;
    const unlisten = listen<ViewMode>("view-mode", (event) => {
      if (event.payload !== "sidebar") return;
      const before = useProjectStore.getState().current;
      restoreProject();
      if (useProjectStore.getState().current === before) void useProjectStore.getState().refresh();
      void useLibraryStore.getState().load();
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  return (
    <div className="flex h-full flex-col text-fs-13">
      <TitleBar />
      <TabNav />
      <main className="flex-1 overflow-y-auto p-4">
        <ErrorBoundary resetKey={activeTab}>
          {activeTab === "live" ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <SidebarSessionPicker />
                <RepoLine />
              </div>
              <LiveView compact={!wide} />
            </div>
          ) : activeTab === "suggest" ? (
            <div className="space-y-8">
              {wide && (
                <>
                  <SuggestBox />
                  <StarterPanel onApply={setDraft} fresh={fresh} />
                </>
              )}
              <LivePanel />
              <DecisionsPanel compact />
              <SuggestFeed compact />
            </div>
          ) : activeTab === "adaptive" ? (
            <AdaptiveSidebar />
          ) : activeTab === "docs" ? (
            <DocsTab />
          ) : (
            <MemoPanel compact />
          )}
        </ErrorBoundary>
      </main>
      <StatusBar />
      <SyncNotice />
      <UpdateNotice compact />
    </div>
  );
}
