import { useEffect } from "react";
import { useT } from "../../i18n";
import { pickSession, type Session, useActivityStore } from "../../store/activity";
import { useProjectStore } from "../../store/project";
import { ConnectHint } from "../suggest/ConnectHint";
import { FileMap } from "./FileMap";
import { LiveStatus, StatusOrb, stateColor } from "./LiveStatus";
import { Timeline } from "./Timeline";

const folder = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** The session shown and the project its map draws (the open one without a session). */
export function useShownSession(): { session: Session | null; project: string | null } {
  const sessions = useActivityStore((s) => s.sessions);
  const chosen = useActivityStore((s) => s.chosen);
  const open = useProjectStore((s) => s.current);
  const session = pickSession(sessions, chosen);
  const project = session?.project && !session.cloud ? session.project : open;
  return { session, project };
}

/** Which session is shown, when there is more than one. */
export function SessionSwitcher() {
  const t = useT();
  const sessions = useActivityStore((s) => s.sessions);
  const choose = useActivityStore((s) => s.choose);
  const { session: shown } = useShownSession();
  if (sessions.length < 2) return null;
  const sorted = [...sessions].sort((a, b) => b.at - a.at);
  return (
    <div className="flex flex-wrap gap-1" role="tablist" aria-label={t("live.sessions")}>
      {sorted.map((s) => {
        const selected = s.session === shown?.session;
        return (
          <button
            key={s.session}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => choose(s.session)}
            className={`flex items-center gap-2 rounded-md px-2.5 py-1 text-xs transition-colors ${
              selected ? "bg-active text-text" : "text-text-muted hover:bg-hover hover:text-text"
            }`}
          >
            <span className="size-1.5 rounded-full" style={{ background: stateColor(s.state) }} />
            <span className="max-w-40 truncate">{folder(s.project) || s.session}</span>
            <span className="text-text-subtle">
              {s.cloud ? t("live.surface.cloud") : s.surface || t("live.surface.terminal")}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The centre of the home page: what Claude is doing, on a map of the
 * project's files, and the steps it took.
 */
export function LiveView({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const { session, project } = useShownSession();
  const files = useActivityStore((s) => (project ? s.files[project] : undefined));
  const loadFiles = useActivityStore((s) => s.loadFiles);

  useEffect(() => {
    useActivityStore.getState().init();
  }, []);

  useEffect(() => {
    if (project) void loadFiles(project);
  }, [project, loadFiles]);

  if (!session) {
    return (
      <div className={compact ? "space-y-4" : "space-y-8"}>
        <div className="flex items-center gap-4">
          <StatusOrb state="idle" size={compact ? 40 : 56} />
          <div>
            <div className={`${compact ? "text-sm" : "text-fs-17"} font-semibold`}>
              {t("live.none.title")}
            </div>
            <p className="mt-0.5 text-xs text-text-muted">{t("live.none.description")}</p>
          </div>
        </div>
        <ConnectHint />
        {!compact && project && <FileMap files={files ?? []} session={null} />}
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-5" : "space-y-8"}>
      <LiveStatus session={session} compact={compact} />
      {!session.cloud || Object.keys(session.files).length > 0 ? (
        <FileMap
          files={session.cloud ? [] : (files ?? [])}
          session={session}
          height={compact ? 150 : 300}
        />
      ) : null}
      <Timeline session={session} limit={compact ? 25 : 60} />
    </div>
  );
}
