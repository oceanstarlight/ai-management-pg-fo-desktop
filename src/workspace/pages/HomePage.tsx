import { LiveView, SourcePicker, useShownSession } from "../../features/live/LiveView";
import { RepoLine } from "../../features/live/RepoLine";
import { MemoPanel } from "../../features/memo/MemoPanel";
import { DecisionsPanel } from "../../features/suggest/DecisionsPanel";
import { LivePanel } from "../../features/suggest/LivePanel";
import { StarterPanel, useNewProject } from "../../features/suggest/StarterPanel";
import { SuggestBox } from "../../features/suggest/SuggestBox";
import { useT } from "../../i18n";
import { useActivityStore } from "../../store/activity";
import { useProjectStore } from "../../store/project";
import { useSuggestStore } from "../../store/suggest";

const folder = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/**
 * Home: what Claude is doing, large in the middle; the prompt box, its
 * suggestions, the project's decisions and the branch's notes beside it.
 */
export function HomePage() {
  const t = useT();
  const project = useProjectStore((s) => s.current);
  const { session } = useShownSession();
  const mode = useActivityStore((s) => s.mode);
  const fresh = useNewProject();
  const setDraft = useSuggestStore((s) => s.setDraft);
  const title = session?.project
    ? folder(session.project)
    : mode === "local" && project
      ? folder(project)
      : null;

  return (
    <div className="grid h-full grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
      <section className="min-w-0 overflow-y-auto px-10 pt-8 pb-16">
        <header className="mb-10 space-y-3">
          <h1 className="text-fs-20 font-semibold tracking-tight">
            {title ?? t("shell.nav.live")}
          </h1>
          <SourcePicker />
          {project && mode === "local" && <RepoLine />}
        </header>
        <LiveView />
      </section>
      <aside className="min-w-0 space-y-10 overflow-y-auto border-border px-7 pt-8 pb-16 xl:border-l">
        <SuggestBox />
        <StarterPanel onApply={setDraft} fresh={fresh} />
        <LivePanel />
        <DecisionsPanel compact />
        {project && <MemoPanel compact />}
      </aside>
    </div>
  );
}
