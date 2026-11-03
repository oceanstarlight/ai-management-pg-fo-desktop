import { PageHeader, Tabs } from "../../components/ui";
import { CatalogPanel } from "../../features/catalog/CatalogPanel";
import { LibraryPanel } from "../../features/docs/LibraryPanel";
import { ExtensionGallery } from "../../features/extensions/ExtensionGallery";
import { useT } from "../../i18n";
import { type ToolsTab, useWorkspaceStore } from "../../store/workspace";
import { McpHubPanel } from "./McpHubPanel";
import { McpPage } from "./McpPage";

/** What Claude can be given: skills and subagents, MCP servers, extensions, ready-made blocks. */
export function ToolsPage() {
  const t = useT();
  const tab = useWorkspaceStore((s) => s.toolsTab);
  const setTab = useWorkspaceStore((s) => s.setToolsTab);
  const tabs: { value: ToolsTab; label: string }[] = [
    { value: "library", label: t("tools.tab.library") },
    { value: "mcp", label: t("tools.tab.mcp") },
    { value: "hub", label: t("tools.tab.hub") },
    { value: "extensions", label: t("tools.tab.extensions") },
    { value: "catalog", label: t("tools.tab.catalog") },
  ];
  return (
    <div className="mx-auto max-w-4xl px-10 pt-8 pb-16">
      <PageHeader title={t("shell.nav.toolbox")} description={t("tools.page.description")} />
      <div className="mb-8">
        <Tabs label={t("shell.nav.toolbox")} value={tab} options={tabs} onChange={setTab} />
      </div>
      {tab === "library" ? (
        <LibraryPanel />
      ) : tab === "mcp" ? (
        <McpPage embedded />
      ) : tab === "hub" ? (
        <McpHubPanel />
      ) : tab === "extensions" ? (
        <ExtensionGallery />
      ) : (
        <CatalogPanel />
      )}
    </div>
  );
}
