import { LiveView, SessionSwitcher, useShownSession } from "../../features/live/LiveView";
import { RepoLine } from "../../features/live/RepoLine";
import { MemoPanel } from "../../features/memo/MemoPanel";
import { DecisionsPanel } from "../../features/suggest/DecisionsPanel";
import { LivePanel } from "../../features/suggest/LivePanel";
import { StarterPanel, useNewProject } from "../../features/suggest/StarterPanel";
import { SuggestBox } from "../../features/suggest/SuggestBox";
import { useT } from "../../i18n";
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
  const fresh = useNewProject();
  const setDraft = useSuggestStore((s) => s.setDraft);
  const title = session?.project ? folder(session.project) : project ? folder(project) : null;

  return (
    <div className="grid h-full grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
      <section className="min-w-0 overflow-y-auto px-10 pt-8 pb-16">
        <header className="mb-10 space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <h1 className="text-fs-20 font-semibold tracking-tight">
              {title ?? t("shell.nav.live")}
            </h1>
            <SessionSwitcher />
          </div>
          {project && <RepoLine />}
        </header>
        <LiveView />
      </section>
      <aside className="min-w-0 space-y-10 overflow-y-auto border-border px-7 pt-8 pb-16 xl:border-l">
        <SuggestBox />
        {fresh && <StarterPanel onApply={setDraft} />}
        <LivePanel />
        <DecisionsPanel compact />
        {project && <MemoPanel compact />}
      </aside>
    </div>
  );
}
