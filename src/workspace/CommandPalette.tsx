import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n";
import { useAccountStore } from "../store/account";
import { useActivityStore } from "../store/activity";
import { useProjectStore } from "../store/project";
import { useUpdaterStore } from "../store/updater";
import { openConnect, type Page, useWorkspaceStore } from "../store/workspace";
import { switchToSidebar } from "./leave";

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  run: () => void;
}

const folder = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** Opens on Ctrl+K (⌘K): pages, projects and actions, found by typing. */
export function useCommandPaletteKey(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
}

function useCommands(): Command[] {
  const t = useT();
  const go = useWorkspaceStore((s) => s.go);
  const recent = useProjectStore((s) => s.recent);
  const signedIn = !!useAccountStore((s) => s.info?.configured);
  const mode = useActivityStore((s) => s.mode);

  return useMemo(() => {
    const pages: [Page, string][] = [
      ["home", t("shell.nav.live")],
      ["adaptive", t("shell.nav.adaptive")],
      ["project", t("shell.nav.project")],
      ["tools", t("shell.nav.toolbox")],
      ["automations", t("shell.nav.automations")],
      ["memo", t("shell.nav.memo")],
      ["settings", t("shell.nav.settings")],
    ];
    const list: Command[] = pages.map(([page, label]) => ({
      id: `page:${page}`,
      group: t("palette.group.pages"),
      label,
      run: () => go(page),
    }));
    list.push(
      {
        id: "connect",
        group: t("palette.group.actions"),
        label: t("connect.title"),
        run: () => void openConnect(),
      },
      {
        id: "mode",
        group: t("palette.group.actions"),
        label: t(mode === "local" ? "palette.mode.cloud" : "palette.mode.local"),
        run: () => {
          useActivityStore.getState().setMode(mode === "local" ? "cloud" : "local");
          go("home");
        },
      },
      {
        id: "sidebar",
        group: t("palette.group.actions"),
        label: t("shell.switchToSidebar"),
        run: () => void switchToSidebar(),
      },
      {
        id: "update",
        group: t("palette.group.actions"),
        label: t("update.check"),
        run: () => void useUpdaterStore.getState().check(true),
      },
    );
    if (signedIn)
      list.push({
        id: "account",
        group: t("palette.group.actions"),
        label: t("account.title"),
        run: () => useAccountStore.getState().openDialog(),
      });
    for (const path of recent)
      list.push({
        id: `project:${path}`,
        group: t("palette.group.projects"),
        label: folder(path),
        hint: path,
        run: () => void useProjectStore.getState().select(path),
      });
    list.push({
      id: "project:choose",
      group: t("palette.group.projects"),
      label: t("docs.project.choose"),
      run: () => void useProjectStore.getState().choose(),
    });
    return list;
  }, [t, go, recent, signedIn, mode]);
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const t = useT();
  const commands = useCommands();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  const q = query.trim().toLowerCase();
  const found = q
    ? commands.filter((c) =>
        [c.label, c.group, c.hint ?? ""].some((s) => s.toLowerCase().includes(q)),
      )
    : commands;
  const at = Math.min(index, Math.max(0, found.length - 1));

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.title")}
        className="w-full max-w-lg overflow-hidden rounded-xl bg-surface-raised shadow-card"
      >
        <div className="flex items-center gap-2 border-b border-border px-3.5">
          <Search size={15} className="shrink-0 text-text-subtle" />
          <input
            ref={input}
            value={query}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.placeholder")}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((at + 1) % Math.max(1, found.length));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((at - 1 + found.length) % Math.max(1, found.length));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(found[at]);
              }
            }}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-subtle"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto py-1.5">
          {found.length === 0 && (
            <li className="px-4 py-3 text-xs text-text-subtle">{t("palette.none")}</li>
          )}
          {found.map((c, i) => (
            <li key={c.id}>
              {(i === 0 || found[i - 1]?.group !== c.group) && (
                <div className="px-4 pt-2 pb-1 text-fs-10.5 font-medium text-text-subtle">
                  {c.group}
                </div>
              )}
              <button
                type="button"
                onMouseEnter={() => setIndex(i)}
                aria-current={i === at ? "true" : undefined}
                onClick={() => run(c)}
                className={`flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm ${
                  i === at ? "bg-hover" : ""
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.hint && (
                  <span className="max-w-56 truncate text-fs-11 text-text-subtle">{c.hint}</span>
                )}
                {i === at && <CornerDownLeft size={12} className="shrink-0 text-text-subtle" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
