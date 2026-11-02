import { ChevronDown, GitBranch, Pencil } from "lucide-react";
import { useState } from "react";
import { IconButton } from "../../components/ui";
import { timeAgo, useT } from "../../i18n";
import { type Session, useActivityStore } from "../../store/activity";
import { useProjectStore } from "../../store/project";
import { stateColor } from "./LiveStatus";
import { samePath, useShownSession } from "./LiveView";

const folder = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/**
 * A session's name: the one the user gave it, else `fallback`, else its
 * repository or folder, else the start of its id.
 */
export function sessionName(s: Session, names: Record<string, string>, fallback?: string) {
  return names[s.session] || fallback || folder(s.project) || s.session.slice(0, 12);
}

/** The session's branch, small and monospaced; nothing when unknown. */
export function BranchTag({ branch }: { branch?: string }) {
  if (!branch) return null;
  return (
    <span className="flex min-w-0 items-center gap-1 font-mono text-text-subtle">
      <GitBranch size={11} className="shrink-0" />
      <span className="truncate">{branch}</span>
    </span>
  );
}

/**
 * The pencil that renames a session, and the field it opens in place of
 * `children`. Enter saves, Escape cancels, an empty name goes back to the
 * automatic one.
 */
export function Renamable({
  session,
  name,
  children,
}: {
  session: Session;
  name: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const rename = useActivityStore((s) => s.rename);
  const custom = useActivityStore((s) => s.names[session.session] ?? "");
  const [editing, setEditing] = useState<string | null>(null);

  if (editing !== null) {
    const save = () => {
      rename(session.session, editing);
      setEditing(null);
    };
    return (
      <input
        // biome-ignore lint/a11y/noAutofocus: opened by the user's click on rename
        autoFocus
        value={editing}
        maxLength={80}
        placeholder={name}
        aria-label={t("live.rename")}
        onChange={(e) => setEditing(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(null);
        }}
        className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-xs outline-none focus:border-accent"
      />
    );
  }
  return (
    <div className="group flex min-w-0 items-center gap-0.5">
      {children}
      <IconButton
        label={t("live.rename")}
        onClick={() => setEditing(custom || name)}
        className="size-6 opacity-60 group-hover:opacity-100"
      >
        <Pencil size={12} />
      </IconButton>
    </div>
  );
}

/**
 * The sidebar's session picker: every session this app sees, this
 * computer's and the cloud's, newest first. Picking one from another folder
 * opens that folder; the pencil renames the shown one.
 */
export function SidebarSessionPicker() {
  const t = useT();
  const sessions = useActivityStore((s) => s.sessions);
  const names = useActivityStore((s) => s.names);
  const { session: shown } = useShownSession();
  const open = useProjectStore((s) => s.current);

  const byNewest = [...sessions].sort((a, b) => b.at - a.at);
  const local = byNewest.filter((s) => !s.cloud && s.project);
  const cloud = byNewest.filter((s) => s.cloud);
  if (local.length + cloud.length === 0) return null;

  const pick = (id: string) => {
    const s = sessions.find((x) => x.session === id);
    if (!s) return;
    const store = useActivityStore.getState();
    store.setMode(s.cloud ? "cloud" : "local");
    if (!s.cloud && !(open && samePath(s.project, open))) {
      void useProjectStore.getState().select(s.project);
    }
    store.choose(s.session);
  };
  const option = (s: Session) => (
    <option key={s.session} value={s.session}>
      {sessionName(s, names)}
      {s.branch ? ` · ${s.branch}` : ""} · {timeAgo(Math.floor(s.at / 1000))}
      {s.state === "ended" ? ` (${t("live.state.ended")})` : ""}
    </option>
  );

  return (
    <div className="space-y-0.5">
      {shown ? (
        <Renamable session={shown} name={sessionName(shown, names)}>
          <label className="relative flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-hover">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: stateColor(shown.state) }}
            />
            <span className="truncate font-medium">{sessionName(shown, names)}</span>
            <ChevronDown size={12} className="shrink-0 text-text-subtle" />
            <select
              aria-label={t("live.pick.session")}
              value={shown.session}
              onChange={(e) => pick(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            >
              {local.length > 0 && (
                <optgroup label={t("live.pick.local")}>{local.map(option)}</optgroup>
              )}
              {cloud.length > 0 && (
                <optgroup label={t("live.pick.cloud")}>{cloud.map(option)}</optgroup>
              )}
            </select>
          </label>
        </Renamable>
      ) : (
        <label className="relative flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-muted hover:bg-hover">
          {t("live.pick.session")}
          <ChevronDown size={12} className="text-text-subtle" />
          <select
            aria-label={t("live.pick.session")}
            value=""
            onChange={(e) => pick(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            <option value="" disabled>
              {t("live.pick.session")}
            </option>
            {local.length > 0 && (
              <optgroup label={t("live.pick.local")}>{local.map(option)}</optgroup>
            )}
            {cloud.length > 0 && (
              <optgroup label={t("live.pick.cloud")}>{cloud.map(option)}</optgroup>
            )}
          </select>
        </label>
      )}
      {shown?.branch && (
        <div className="px-2 text-fs-11">
          <BranchTag branch={shown.branch} />
        </div>
      )}
    </div>
  );
}
