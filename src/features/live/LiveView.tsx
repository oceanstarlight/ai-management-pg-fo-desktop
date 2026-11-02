import { ChevronDown } from "lucide-react";
import { useEffect } from "react";
import { timeAgo, useT } from "../../i18n";
import { type LiveMode, pickSession, type Session, useActivityStore } from "../../store/activity";
import { useProjectStore } from "../../store/project";
import { ConnectHint } from "../suggest/ConnectHint";
import { LiveStatus, StatusOrb, stateColor } from "./LiveStatus";
import { BranchTag, Renamable, sessionName } from "./SessionPicker";
import { Timeline } from "./Timeline";
import { WorkGraph } from "./WorkGraph";

const folder = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** Same folder, whatever the slashes and (on Windows) the case. */
export const samePath = (a: string, b: string) => {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
};

/** The newest session (by its last activity). */
const newest = (pool: Session[]) =>
  pool.reduce<Session | null>((a, b) => (!a || b.at > a.at ? b : a), null);

/** Local: the open folder's sessions. Cloud: every cloud session, newest first. */
function poolOf(sessions: Session[], mode: LiveMode, open: string | null): Session[] {
  if (mode === "cloud") return sessions.filter((s) => s.cloud).sort((a, b) => b.at - a.at);
  if (!open) return [];
  return sessions
    .filter((s) => !s.cloud && !!s.project && samePath(s.project, open))
    .sort((a, b) => b.at - a.at);
}

/**
 * The session shown and the project its map draws: in local mode the open
 * folder's session (the busiest recent one unless one was picked), in cloud
 * mode the picked cloud session, else the newest.
 */
export function useShownSession(): { session: Session | null; project: string | null } {
  const sessions = useActivityStore((s) => s.sessions);
  const chosen = useActivityStore((s) => s.chosen);
  const mode = useActivityStore((s) => s.mode);
  const open = useProjectStore((s) => s.current);
  const pool = poolOf(sessions, mode, open);
  const session =
    mode === "cloud"
      ? (pool.find((s) => s.session === chosen) ?? newest(pool))
      : pickSession(pool, chosen);
  return { session, project: mode === "local" ? open : null };
}

/**
 * Under the title: in cloud mode which session (the newest by default); in
 * local mode tabs when the open folder has several, and a pointer to a
 * folder where Claude runs when the open one is quiet. Local/cloud and the
 * folder are chosen in the title bar.
 */
export function SourcePicker() {
  const t = useT();
  const sessions = useActivityStore((s) => s.sessions);
  const mode = useActivityStore((s) => s.mode);
  const choose = useActivityStore((s) => s.choose);
  const names = useActivityStore((s) => s.names);
  const open = useProjectStore((s) => s.current);
  const { session: shown } = useShownSession();
  const nth = (s: Session) =>
    t("live.pick.nth", { n: pool.length - pool.findIndex((p) => p.session === s.session) });

  const local = sessions.filter((s) => !s.cloud && s.project);
  const cloud = sessions.filter((s) => s.cloud).sort((a, b) => b.at - a.at);
  const pool = poolOf(sessions, mode, open);
  // Claude runs elsewhere while the open folder is quiet: offer to go there.
  const elsewhere =
    mode === "local" && pool.length === 0
      ? newest(local.filter((s) => s.state !== "ended" && !(open && samePath(s.project, open))))
      : null;

  return (
    <div className="space-y-2">
      {mode === "cloud" && (
        <div className="flex flex-wrap items-center gap-2">
          {cloud.length > 0 ? (
            <Renamable session={shown ?? cloud[0]} name={sessionName(shown ?? cloud[0], names)}>
              <label className="relative flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-hover">
                {shown && (
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: stateColor(shown.state) }}
                  />
                )}
                <span className="max-w-64 truncate font-medium">
                  {shown ? sessionName(shown, names) : t("live.pick.session")}
                </span>
                <ChevronDown size={12} className="shrink-0 text-text-subtle" />
                <select
                  aria-label={t("live.pick.session")}
                  value={shown?.session ?? ""}
                  onChange={(e) => choose(e.target.value || null)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                >
                  {cloud.map((s, i) => (
                    <option key={s.session} value={s.session}>
                      {sessionName(s, names)}
                      {s.branch ? ` · ${s.branch}` : ""} · {timeAgo(Math.floor(s.at / 1000))}
                      {i === 0 ? ` (${t("live.pick.latest")})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </Renamable>
          ) : (
            <span className="text-xs text-text-subtle">{t("live.pick.noCloud")}</span>
          )}
          {shown && (
            <span className="text-xs">
              <BranchTag branch={shown.branch} />
            </span>
          )}
        </div>
      )}

      {mode === "local" && pool.length === 1 && shown && (
        <div className="flex items-center gap-2 text-xs">
          <Renamable session={shown} name={sessionName(shown, names, nth(shown))}>
            <span className="truncate px-2 font-medium">
              {sessionName(shown, names, nth(shown))}
            </span>
          </Renamable>
          <BranchTag branch={shown.branch} />
        </div>
      )}

      {mode === "local" && pool.length > 1 && (
        <div
          className="flex flex-wrap items-center gap-1"
          role="tablist"
          aria-label={t("live.sessions")}
        >
          {pool.map((s) => {
            const selected = s.session === shown?.session;
            return (
              <button
                key={s.session}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => choose(s.session)}
                className={`flex items-center gap-2 rounded-md px-2.5 py-1 text-xs transition-colors ${
                  selected
                    ? "bg-active text-text"
                    : "text-text-muted hover:bg-hover hover:text-text"
                }`}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: stateColor(s.state) }}
                />
                <span className="max-w-48 truncate">{sessionName(s, names, nth(s))}</span>
                {s.branch ? (
                  <BranchTag branch={s.branch} />
                ) : (
                  <span className="text-text-subtle">
                    {s.surface || t("live.surface.terminal")}
                  </span>
                )}
              </button>
            );
          })}
          {shown && (
            <Renamable session={shown} name={sessionName(shown, names, nth(shown))}>
              {null}
            </Renamable>
          )}
        </div>
      )}

      {elsewhere && (
        <p className="text-xs text-text-muted">
          {t("live.pick.elsewhere", { folder: folder(elsewhere.project) })}{" "}
          <button
            type="button"
            className="font-medium text-accent hover:underline"
            onClick={() => void useProjectStore.getState().select(elsewhere.project)}
          >
            {t("live.pick.go")}
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * The centre of the home page: what Claude is doing, the graph of Claude,
 * its subagents and what they work on, and the steps it took.
 */
export function LiveView({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const { session } = useShownSession();

  useEffect(() => {
    useActivityStore.getState().init();
  }, []);

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
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-5" : "space-y-8"}>
      <LiveStatus session={session} compact={compact} />
      {!compact && <WorkGraph session={session} />}
      <Timeline session={session} limit={compact ? 3 : 6} />
    </div>
  );
}
