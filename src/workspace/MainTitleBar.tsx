import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Bell, ChevronsUpDown, Copy, Minus, Search, Square, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Segmented } from "../components/ui";
import { stateColor, stateLabel } from "../features/live/LiveStatus";
import { useShownSession } from "../features/live/LiveView";
import { dismissNotice, NoticeCard, TONE, useNotices } from "../features/notices/NoticeStack";
import { useT } from "../i18n";
import { type LiveMode, useActivityStore } from "../store/activity";
import { useNoticesStore } from "../store/notices";
import { useProjectStore } from "../store/project";
import { useWorkspaceStore } from "../store/workspace";

const CHOOSE = "\u0000choose";
const folder = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

/**
 * The main window's own title bar (the window is undecorated): the open
 * project and local/cloud on the left, what Claude is doing in the middle,
 * search, notices and the window buttons on the right. Drags the window.
 */
export function MainTitleBar({ onSearch }: { onSearch: () => void }) {
  const t = useT();
  return (
    <header
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-sidebar pl-2 select-none"
    >
      <ProjectSwitch />
      <ModeSwitch />
      <div data-tauri-drag-region className="flex min-w-0 flex-1 justify-center px-2">
        <StatusLine />
      </div>
      <button
        type="button"
        onClick={onSearch}
        className="flex h-7 items-center gap-2 rounded-md bg-sunken px-2.5 text-fs-12 text-text-subtle hover:text-text"
      >
        <Search size={13} />
        <span className="hidden lg:inline">{t("palette.open")}</span>
        <kbd className="font-sans text-fs-10.5">{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <NoticeBell />
      <WindowButtons />
    </header>
  );
}

function ProjectSwitch() {
  const t = useT();
  const project = useProjectStore((s) => s.current);
  const recent = useProjectStore((s) => s.recent);
  const projects = project && !recent.includes(project) ? [project, ...recent] : recent;
  return (
    <label
      className="relative flex h-7 max-w-52 items-center gap-1.5 rounded-md px-2 text-fs-12 hover:bg-hover"
      title={project ?? undefined}
    >
      <span className="text-text-subtle">{t("shell.project")}</span>
      <span className="truncate font-medium">
        {project ? folder(project) : t("docs.project.none")}
      </span>
      <ChevronsUpDown size={12} className="shrink-0 text-text-subtle" />
      <select
        aria-label={t("docs.project.recent")}
        value={project ?? ""}
        onChange={(e) => {
          const { select, choose } = useProjectStore.getState();
          useActivityStore.getState().choose(null);
          if (e.target.value === CHOOSE) void choose();
          else if (e.target.value) void select(e.target.value);
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {!project && <option value="">{t("docs.project.none")}</option>}
        {projects.map((path) => (
          <option key={path} value={path}>
            {folder(path)}
          </option>
        ))}
        <option value={CHOOSE}>{t("docs.project.choose")}</option>
      </select>
    </label>
  );
}

function ModeSwitch() {
  const t = useT();
  const mode = useActivityStore((s) => s.mode);
  const setMode = useActivityStore((s) => s.setMode);
  const sessions = useActivityStore((s) => s.sessions);
  const local = sessions.filter((s) => !s.cloud).length;
  const cloud = sessions.length - local;
  return (
    <Segmented<LiveMode>
      label={t("live.mode")}
      value={mode}
      options={[
        { value: "local", label: t("live.mode.local", { n: local }) },
        { value: "cloud", label: t("live.mode.cloud", { n: cloud }) },
      ]}
      onChange={(m) => {
        setMode(m);
        useWorkspaceStore.getState().go("home");
      }}
    />
  );
}

/** One line: how many sessions run, what the shown one does, its context. */
function StatusLine() {
  const t = useT();
  const sessions = useActivityStore((s) => s.sessions);
  const { session } = useShownSession();
  const go = useWorkspaceStore((s) => s.go);
  const running = sessions.filter((s) => s.state !== "idle" && s.state !== "ended").length;
  if (!session) {
    return (
      <span data-tauri-drag-region className="truncate text-fs-12 text-text-subtle">
        {t("title.status.none")}
      </span>
    );
  }
  const color = stateColor(session.state);
  const context = session.usage.contextPercent;
  return (
    <button
      type="button"
      onClick={() => go("home")}
      className="flex min-w-0 max-w-full items-center gap-2 rounded-md px-2 py-1 text-fs-12 hover:bg-hover"
    >
      <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="shrink-0 font-medium" style={{ color }}>
        {t(stateLabel(session.state))}
      </span>
      {session.doing && (
        <span className="min-w-0 truncate font-mono text-fs-11 text-text-muted">
          {session.doing}
        </span>
      )}
      {context !== null && (
        <span className="shrink-0 text-text-subtle">
          · {t("title.status.context", { n: Math.round(context) })}
        </span>
      )}
      {running > 1 && (
        <span className="shrink-0 text-text-subtle">
          · {t("title.status.running", { n: running })}
        </span>
      )}
    </button>
  );
}

/** The notices, also when the menu is folded: a count and a list. */
function NoticeBell() {
  const t = useT();
  const notices = useNotices();
  const remember = useNoticesStore((s) => s.dismiss);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  const worst = notices.some((n) => n.tone === "danger")
    ? "danger"
    : notices.some((n) => n.tone === "warning")
      ? "warning"
      : "info";
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={t("notice.count", { n: notices.length })}
        title={t("notice.count", { n: notices.length })}
        className="relative flex size-8 items-center justify-center rounded-md hover:bg-hover"
      >
        <Bell size={15} className={notices.length ? TONE[worst] : "text-text-subtle"} />
        {notices.length > 0 && (
          <span className="absolute top-1 right-1 min-w-3.5 rounded-full bg-sunken px-0.5 text-center text-fs-10 leading-3.5 font-semibold">
            {notices.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute top-9 right-0 z-40 w-80 space-y-1.5 rounded-xl bg-sidebar p-2 shadow-card">
          {notices.length === 0 ? (
            <p className="px-2 py-3 text-center text-fs-12 text-text-subtle">
              {t("title.notices.none")}
            </p>
          ) : (
            [...notices]
              .reverse()
              .map((n) => (
                <NoticeCard key={n.id} notice={n} onDismiss={() => dismissNotice(n, remember)} />
              ))
          )}
        </div>
      )}
    </div>
  );
}

function WindowButtons() {
  const t = useT();
  const [max, setMax] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    void win.isMaximized().then(setMax);
    const stop = win.onResized(() => void win.isMaximized().then(setMax));
    return () => {
      void stop.then((f) => f());
    };
  }, []);
  if (!isTauri()) return null;
  const win = getCurrentWindow();
  return (
    <div className="flex h-full">
      <WinButton label={t("title.minimize")} onClick={() => void win.minimize()}>
        <Minus size={15} />
      </WinButton>
      <WinButton
        label={t(max ? "title.restore" : "title.maximize")}
        onClick={() => void win.toggleMaximize()}
      >
        {max ? <Copy size={12} className="-scale-x-100" /> : <Square size={12} />}
      </WinButton>
      <WinButton label={t("title.close")} onClick={() => void win.close()} danger>
        <X size={16} />
      </WinButton>
    </div>
  );
}

function WinButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-full w-11 items-center justify-center text-text-muted transition-colors ${
        danger ? "hover:bg-danger-soft hover:text-danger" : "hover:bg-hover hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}
