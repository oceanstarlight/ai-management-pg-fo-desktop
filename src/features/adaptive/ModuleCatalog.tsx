import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui";
import { type MessageKey, useT } from "../../i18n";
import { type CatalogModule, type ModuleKind, useHubStore } from "../../store/hub";
import { KindBadge } from "./ModulesPanel";

type Filter = "all" | ModuleKind;

/** Ready-made modules, checked for license and content, to add with one click. */
export function ModuleCatalog() {
  const t = useT();
  const catalog = useHubStore((s) => s.catalog);
  const entries = useHubStore((s) => s.entries);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void useHubStore.getState().loadCatalog();
  }, []);

  const shown = useMemo(
    () => catalog.filter((c) => filter === "all" || c.module.kind === filter),
    [catalog, filter],
  );
  const describe = (c: CatalogModule) => c.module.description || t(`mcp.rec.${c.id}` as MessageKey);

  const add = async (c: CatalogModule) => {
    setError(null);
    try {
      await useHubStore.getState().save(null, { ...c.module, description: describe(c) });
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <p className="text-xs text-text-muted">{t("adaptive.catalog.hint")}</p>
        <div className="ml-auto flex gap-1 rounded-lg bg-sunken p-0.5 text-xs">
          {(["all", "mcp", "cli"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-2 py-0.5 font-medium ${
                filter === f ? "bg-surface-raised text-text shadow-card" : "text-text-muted"
              }`}
            >
              {f === "all" ? t("adaptive.catalog.all") : t(`adaptive.kind.${f}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="selectable mb-2 text-xs text-danger">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        {shown.map((c) => {
          const added = entries.some((e) => e.name === c.module.name);
          const src = c.module.source;
          return (
            <div
              key={c.id}
              className="flex items-start gap-2 rounded-lg bg-surface-raised px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium">{c.module.name}</span>
                  <KindBadge entry={c.module} />
                  {src ? (
                    <button
                      type="button"
                      onClick={() => void openUrl(`https://github.com/${src.repo}`)}
                      title={src.repo}
                      className="flex items-center gap-0.5 text-fs-10 text-text-subtle hover:text-text"
                    >
                      {src.license}
                      <ExternalLink size={9} />
                    </button>
                  ) : (
                    <span className="text-fs-10 text-text-subtle">{t("mcp.rec.hosted")}</span>
                  )}
                  {c.needs && (
                    <span className="rounded bg-sunken px-1 text-fs-10 text-text-subtle">
                      {t(`adaptive.needs.${c.needs}` as MessageKey)}
                    </span>
                  )}
                  {c.module.warnings.length > 0 && (
                    <span title={c.module.warnings.join("\n")} className="text-warning">
                      <AlertTriangle size={11} />
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-fs-11 leading-snug text-text-muted">{describe(c)}</p>
              </div>
              <Button size="sm" disabled={added} onClick={() => void add(c)}>
                {added ? t("mcp.rec.added") : t("mcp.rec.add")}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
