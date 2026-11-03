import { ShieldAlert, X } from "lucide-react";
import { useEffect } from "react";
import { PageHeader, Tabs } from "../../components/ui";
import { CombosPanel } from "../../features/adaptive/CombosPanel";
import { Gateway } from "../../features/adaptive/Gateway";
import { ModuleCatalog } from "../../features/adaptive/ModuleCatalog";
import { ModulesPanel } from "../../features/adaptive/ModulesPanel";
import { useT } from "../../i18n";
import { useHubStore } from "../../store/hub";
import { type AdaptiveTab, useWorkspaceStore } from "../../store/workspace";
import { McpPage } from "./McpPage";

/**
 * Adaptive tools: modules (MCP servers, CLIs, libraries) kept without
 * installing them, combinations of them, the ready-made catalog, and the MCP
 * servers the project has installed.
 */
export function AdaptivePage() {
  const t = useT();
  const tab = useWorkspaceStore((s) => s.adaptiveTab);
  const setTab = useWorkspaceStore((s) => s.setAdaptiveTab);
  const error = useHubStore((s) => s.error);
  const combos = useHubStore((s) => s.combos.length);
  const modules = useHubStore((s) => s.entries.length);

  useEffect(() => {
    void useHubStore.getState().load();
    void useHubStore.getState().loadServer();
  }, []);

  const tabs: { value: AdaptiveTab; label: string }[] = [
    { value: "modules", label: `${t("adaptive.tab.modules")} ${modules || ""}`.trim() },
    { value: "combos", label: `${t("adaptive.tab.combos")} ${combos || ""}`.trim() },
    { value: "catalog", label: t("adaptive.tab.catalog") },
    { value: "installed", label: t("adaptive.tab.installed") },
  ];

  return (
    <div className="mx-auto max-w-4xl px-10 pt-8 pb-16">
      <PageHeader title={t("shell.nav.adaptive")} description={t("adaptive.description")} />
      <div className="mb-6">
        <Gateway />
      </div>
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          <p className="selectable min-w-0 flex-1 whitespace-pre-wrap break-words">{error}</p>
          <button
            type="button"
            aria-label={t("work.close")}
            onClick={() => useHubStore.getState().dismissError()}
          >
            <X size={13} />
          </button>
        </div>
      )}
      <div className="mb-6">
        <Tabs label={t("shell.nav.adaptive")} value={tab} options={tabs} onChange={setTab} />
      </div>
      {tab === "modules" ? (
        <ModulesPanel />
      ) : tab === "combos" ? (
        <CombosPanel />
      ) : tab === "catalog" ? (
        <ModuleCatalog />
      ) : (
        <McpPage embedded />
      )}
      {tab !== "installed" && (
        <p className="mt-8 flex items-start gap-1.5 text-fs-11 leading-snug text-text-subtle">
          <ShieldAlert size={12} className="mt-0.5 shrink-0" />
          {t("hub.security")}
        </p>
      )}
    </div>
  );
}
