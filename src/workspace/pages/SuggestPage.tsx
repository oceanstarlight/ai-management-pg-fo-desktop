import { Logo } from "../../components/Logo";
import { DecisionsPanel } from "../../features/suggest/DecisionsPanel";
import { LivePanel } from "../../features/suggest/LivePanel";
import { StarterPanel, useNewProject } from "../../features/suggest/StarterPanel";
import { SuggestBox } from "../../features/suggest/SuggestBox";
import { SuggestFeed } from "../../features/suggest/SuggestFeed";
import { type MessageKey, useLocale, useT } from "../../i18n";
import { itemName, useSuggestStore } from "../../store/suggest";

/** The home page: a prompt box with suggestions, and what Claude Code suggested. */
export function SuggestPage() {
  const t = useT();
  const fresh = useNewProject();
  const setDraft = useSuggestStore((s) => s.setDraft);
  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="mb-2 flex items-center gap-3">
        <Logo size={34} className="shrink-0 drop-shadow-sm" />
        <h1 className="font-serif text-fs-28 leading-tight font-medium tracking-tight">
          {t("suggest.title")}
        </h1>
      </div>
      <p className="mb-6 max-w-2xl text-sm text-text-muted">{t("suggest.description")}</p>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-8">
          <SuggestBox />
          <LivePanel />
          <SuggestFeed />
        </div>
        <aside className="space-y-6">
          {fresh && <StarterPanel onApply={setDraft} />}
          <DecisionsPanel />
          <Stats />
          <CatalogCounts />
        </aside>
      </div>
    </div>
  );
}

function Stats() {
  const t = useT();
  const locale = useLocale();
  const { prompts, picked, top } = useSuggestStore((s) => s.overview);
  return (
    <section>
      <div className="grid grid-cols-2 gap-2">
        <Tile label={t("suggest.stats.prompts")} value={prompts} />
        <Tile label={t("suggest.stats.picked")} value={picked} />
      </div>
      {top.length > 0 && (
        <>
          <h2 className="mt-5 mb-2 px-1 text-xs font-semibold text-text-muted">
            {t("suggest.stats.top")}
          </h2>
          <ul className="rounded-xl border border-border bg-surface-raised p-1.5">
            {top.map((item) => (
              <li key={item.key} className="flex items-center gap-2 px-2 py-1.5 text-fs-13">
                <span className="min-w-0 flex-1 truncate font-mono">{itemName(item, locale)}</span>
                <span className="shrink-0 text-fs-11 text-text-subtle tabular-nums">
                  {item.picked}/{item.shown}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised px-3 py-2.5">
      <div className="text-fs-22 font-semibold tabular-nums">{value}</div>
      <div className="text-fs-11 text-text-muted">{label}</div>
    </div>
  );
}

function CatalogCounts() {
  const t = useT();
  const candidates = useSuggestStore((s) => s.candidates);
  const count = (f: (c: (typeof candidates)[number]) => boolean) => candidates.filter(f).length;
  const rows: [MessageKey, number][] = [
    ["suggest.catalog.installed", count((c) => c.source === "installed" && c.kind !== "mcp")],
    ["suggest.catalog.library", count((c) => c.source === "library")],
    ["suggest.catalog.mcp", count((c) => c.kind === "mcp")],
    ["suggest.catalog.extensions", count((c) => c.source === "extension")],
    ["suggest.catalog.automations", count((c) => c.source === "automation")],
  ];
  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-semibold text-text-muted">
        {t("suggest.catalog.title")}
      </h2>
      <ul className="rounded-xl border border-border bg-surface-raised p-1.5">
        {rows.map(([key, n]) => (
          <li key={key} className="flex items-center px-2 py-1.5 text-fs-13">
            <span className="flex-1 text-text-muted">{t(key)}</span>
            <span className="tabular-nums">{n}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
