import { Check, Copy, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../../i18n";
import { type ComboView, fitOf, type HubEntry, hubCanRun, useHubStore } from "../../store/hub";
import { getPref, onPrefChanged, setPref } from "../../store/prefs";
import { useWorkspaceStore } from "../../store/workspace";
import { InfoTip } from "../suggest/KindBadge";
import { FitMeter } from "./CombosPanel";
import { hubReady } from "./Gateway";
import { KindBadge } from "./ModulesPanel";

/** Slots shown at most; empty ones stay as outlines. */
const SLOTS = 5;
type View = "modules" | "combos";
const PREF: Record<View, string> = { modules: "dockModules", combos: "dockCombos" };
const VIEW_PREF = "dockView";

/** The names kept in the dock, or `null` before the user changed it. */
function readPinned(view: View): string[] | null {
  try {
    const raw = getPref(PREF[view]);
    const list = raw ? JSON.parse(raw) : null;
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : null;
  } catch {
    return null;
  }
}

function usePinned(view: View, all: string[]): [string[], (next: string[]) => void] {
  const [pinned, setPinned] = useState(() => readPinned(view));
  useEffect(() => {
    setPinned(readPinned(view));
    return onPrefChanged(PREF[view], () => setPinned(readPinned(view)));
  }, [view]);
  // Until the user picks, the first ones; names that are gone drop out.
  const shown = (pinned ?? all).filter((n) => all.includes(n)).slice(0, SLOTS);
  const save = (next: string[]) => setPref(PREF[view], JSON.stringify(next.slice(0, SLOTS)));
  return [shown, save];
}

/**
 * Home's module dock, under "Claude Code live": up to five modules (or
 * combinations) at hand. "Use" copies a line asking Claude to open it
 * through the hub, to paste into Claude Code; + adds another.
 */
export function ModuleDock() {
  const t = useT();
  const entries = useHubStore((s) => s.entries);
  const combos = useHubStore((s) => s.combos);
  const server = useHubStore((s) => s.server);
  const [view, setView] = useState<View>(() =>
    getPref(VIEW_PREF) === "combos" ? "combos" : "modules",
  );
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    const hub = useHubStore.getState();
    if (!hub.loaded) void hub.load();
    if (!hub.server) void hub.loadServer();
  }, []);

  const names = useMemo(
    () => (view === "modules" ? entries.map((e) => e.name) : combos.map((c) => c.name)),
    [view, entries, combos],
  );
  const [pinned, savePinned] = usePinned(view, names);
  const rest = names.filter((n) => !pinned.includes(n));
  const connected = hubReady(server);

  const switchView = (v: View) => {
    setView(v);
    setPicking(false);
    setPref(VIEW_PREF, v);
  };

  /** Copies the request for Claude Code; true once it is on the clipboard. */
  const use = async (name: string): Promise<boolean> => {
    const text =
      view === "modules"
        ? t("adaptive.dock.useModule", { name })
        : t("adaptive.dock.useCombo", { name });
    const copied = await navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    );
    if (view === "modules") {
      const e = entries.find((x) => x.name === name);
      // Using it means the hub offers it.
      if (e && !e.inHub && hubCanRun(e)) await useHubStore.getState().setInHub(e, true);
    }
    return copied;
  };

  return (
    <section>
      <div className="mb-2 flex items-center gap-2 px-1">
        <h2 className="flex flex-1 items-center gap-1 text-fs-11 font-medium tracking-wide text-text-subtle">
          {t("shell.nav.adaptive")}
          <InfoTip title={t("adaptive.help.title")}>
            <p>{t("adaptive.dock.help1")}</p>
            <p>{t("adaptive.dock.help2")}</p>
            <p>{t("adaptive.dock.help3")}</p>
          </InfoTip>
        </h2>
        <div className="flex gap-0.5 rounded-md bg-sunken p-0.5 text-fs-11">
          {(["modules", "combos"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => switchView(v)}
              className={`rounded px-1.5 py-0.5 font-medium ${
                view === v ? "bg-surface-raised text-text shadow-card" : "text-text-muted"
              }`}
            >
              {t(v === "modules" ? "adaptive.tab.modules" : "adaptive.tab.combos")}
            </button>
          ))}
        </div>
      </div>

      <ul className="space-y-1.5">
        {Array.from({ length: SLOTS }, (_, i) => {
          const name = pinned[i];
          if (!name) {
            return (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: empty slots have no identity
                key={`empty-${i}`}
                aria-hidden
                className="h-11 rounded-lg border border-dashed border-border"
              />
            );
          }
          const entry = entries.find((e) => e.name === name);
          const combo = combos.find((c) => c.name === name);
          return (
            <Slot
              key={name}
              name={name}
              entry={view === "modules" ? entry : undefined}
              combo={view === "combos" ? combo : undefined}
              onUse={() => use(name)}
              onRemove={() => savePinned(pinned.filter((n) => n !== name))}
            />
          );
        })}
      </ul>

      <div className="relative mt-2">
        <button
          type="button"
          disabled={pinned.length >= SLOTS}
          onClick={() => setPicking(!picking)}
          aria-expanded={picking}
          className="flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-fs-12 text-text-muted hover:bg-hover hover:text-text disabled:pointer-events-none disabled:opacity-40"
        >
          <Plus size={13} />
          {t(view === "modules" ? "adaptive.dock.addModule" : "adaptive.dock.addCombo")}
        </button>
        {picking && (
          <div className="absolute right-0 left-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-lg bg-surface-raised p-1 shadow-lg ring-1 ring-border">
            {rest.length === 0 ? (
              <p className="px-2.5 py-2 text-fs-12 text-text-subtle">{t("adaptive.dock.noMore")}</p>
            ) : (
              rest.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    savePinned([...pinned, n]);
                    setPicking(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-fs-12 hover:bg-hover"
                >
                  <span className="min-w-0 flex-1 truncate">{n}</span>
                  {view === "modules"
                    ? (() => {
                        const e = entries.find((x) => x.name === n);
                        return e ? <KindBadge entry={e} /> : null;
                      })()
                    : (() => {
                        const c = combos.find((x) => x.name === n);
                        return c ? <FitMeter fit={fitOf(c)} compact /> : null;
                      })()}
                </button>
              ))
            )}
            <button
              type="button"
              onClick={() => {
                const ws = useWorkspaceStore.getState();
                ws.setAdaptiveTab(view === "modules" ? "catalog" : "combos");
                ws.go("adaptive");
              }}
              className="mt-1 w-full rounded-md px-2.5 py-1.5 text-left text-fs-11 text-text-subtle hover:bg-hover hover:text-text"
            >
              {t(view === "modules" ? "adaptive.dock.findMore" : "adaptive.dock.makeCombo")}
            </button>
          </div>
        )}
      </div>
      {!connected && server?.claudeFound && (
        <p className="mt-2 px-1 text-fs-11 text-text-subtle">{t("adaptive.dock.notConnected")}</p>
      )}
    </section>
  );
}

function Slot({
  name,
  entry,
  combo,
  onUse,
  onRemove,
}: {
  name: string;
  entry?: HubEntry;
  combo?: ComboView;
  onUse: () => Promise<boolean>;
  onRemove: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const sub = entry
    ? entry.description
    : combo
      ? combo.members.map((m) => m.module).join(" + ")
      : "";
  const on = entry ? entry.inHub && hubCanRun(entry) : true;
  return (
    <li className="group flex h-11 items-center gap-2 rounded-lg bg-surface-raised px-2.5">
      <span
        className={`size-1.5 shrink-0 rounded-full ${on ? "bg-accent" : "bg-border-strong"}`}
        title={on ? t("hub.inHub") : t("adaptive.dock.offHub")}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-fs-12 font-medium">{name}</span>
          {entry && <KindBadge entry={entry} />}
          {combo && <FitMeter fit={fitOf(combo)} compact />}
        </div>
        {sub && <div className="truncate text-fs-10.5 text-text-subtle">{sub}</div>}
      </div>
      <button
        type="button"
        onClick={() =>
          void onUse().then((ok) => {
            if (!ok) return;
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
        title={t("adaptive.dock.use")}
        aria-label={t("adaptive.dock.use")}
        className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-fs-11 hover:bg-hover ${
          copied ? "text-success" : "text-text-muted hover:text-text"
        }`}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {t(copied ? "adaptive.dock.copied" : "adaptive.dock.useShort")}
      </button>
      <button
        type="button"
        onClick={onRemove}
        title={t("adaptive.dock.remove")}
        aria-label={t("adaptive.dock.remove")}
        className="shrink-0 rounded p-0.5 text-text-subtle opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-text focus-visible:opacity-100"
      >
        <X size={12} />
      </button>
    </li>
  );
}
