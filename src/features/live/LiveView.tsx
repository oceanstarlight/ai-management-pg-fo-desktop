import { ChevronDown, FolderOpen } from "lucide-react";
import { useEffect } from "react";
import { Segmented } from "../../components/ui";
import { timeAgo, useT } from "../../i18n";
import { type LiveMode, pickSession, type Session, useActivityStore } from "../../store/activity";
import { useProjectStore } from "../../store/project";
import { ConnectHint } from "../suggest/ConnectHint";
import { FileMap } from "./FileMap";
import { LiveStatus, StatusOrb, stateColor } from "./LiveStatus";
import { Timeline } from "./Timeline";

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

const CHOOSE = "\u0000choose";

/**
 * Local or cloud, then which: a project folder (local) or a session (cloud,
 * the newest by default). Several sessions in one folder get tabs.
 */
export function SourcePicker() {
  const t = useT();
  const sessions = useActivityStore((s) => s.sessions);
  const mode = useActivityStore((s) => s.mode);
  const setMode = useActivityStore((s) => s.setMode);
  const choose = useActivityStore((s) => s.choose);
  const open = useProjectStore((s) => s.current);
  const recent = useProjectStore((s) => s.recent);
  const { session: shown } = useShownSession();

  const local = sessions.filter((s) => !s.cloud && s.project);
  const cloud = sessions.filter((s) => s.cloud).sort((a, b) => b.at - a.at);
  // Recent folders, plus any folder Claude is running in now.
  const folders: string[] = [];
  for (const path of [...(open ? [open] : []), ...local.map((s) => s.project), ...recent]) {
    if (!folders.some((f) => samePath(f, path))) folders.push(path);
  }
  const running = (path: string) =>
    local.some((s) => samePath(s.project, path) && s.state !== "ended");
  const pool = poolOf(sessions, mode, open);
  // Claude runs elsewhere while the open folder is quiet: offer to go there.
  const elsewhere =
    mode === "local" && pool.length === 0
      ? newest(local.filter((s) => s.state !== "ended" && !(open && samePath(s.project, open))))
      : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label={t("live.mode")}
          value={mode}
          options={[
            { value: "local", label: t("live.mode.local", { n: local.length }) },
            { value: "cloud", label: t("live.mode.cloud", { n: cloud.length }) },
          ]}
          onChange={setMode}
        />
        {mode === "local" ? (
          <label className="relative flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-hover">
            <FolderOpen size={13} className="shrink-0 text-text-subtle" />
            <span className="max-w-56 truncate font-medium" title={open ?? undefined}>
              {open ? folder(open) : t("live.pick.folder")}
            </span>
            <ChevronDown size={12} className="shrink-0 text-text-subtle" />
            <select
              aria-label={t("live.pick.folder")}
              value={folders.find((f) => open && samePath(f, open)) ?? ""}
              onChange={(e) => {
                const { select, choose: pick } = useProjectStore.getState();
                choose(null);
                if (e.target.value === CHOOSE) void pick();
                else if (e.target.value) void select(e.target.value);
              }}
              className="absolute inset-0 cursor-pointer opacity-0"
            >
              {!open && <option value="">{t("live.pick.folder")}</option>}
              {folders.map((path) => (
                <option key={path} value={path}>
                  {running(path) ? "● " : ""}
                  {folder(path)}
                </option>
              ))}
              <option value={CHOOSE}>{t("docs.project.choose")}</option>
            </select>
          </label>
        ) : cloud.length > 0 ? (
          <label className="relative flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-hover">
            {shown && (
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: stateColor(shown.state) }}
              />
            )}
            <span className="max-w-64 truncate font-medium">
              {shown ? sessionLabel(shown) : t("live.pick.session")}
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
                  {sessionLabel(s)} · {timeAgo(Math.floor(s.at / 1000))}
                  {i === 0 ? ` (${t("live.pick.latest")})` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="text-xs text-text-subtle">{t("live.pick.noCloud")}</span>
        )}
      </div>

      {mode === "local" && pool.length > 1 && (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label={t("live.sessions")}>
          {pool.map((s, i) => {
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
                {t("live.pick.nth", { n: pool.length - i })}
                <span className="text-text-subtle">{s.surface || t("live.surface.terminal")}</span>
              </button>
            );
          })}
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

/** A cloud session's name: its repository, else its id. */
const sessionLabel = (s: Session) => folder(s.project) || s.session.slice(0, 12);

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
