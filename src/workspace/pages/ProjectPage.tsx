import { PageHeader, Tabs } from "../../components/ui";
import { ConfigMapPanel } from "../../features/docs/ConfigMapPanel";
import { DecisionsPanel } from "../../features/suggest/DecisionsPanel";
import { StartersCard } from "../../features/suggest/StartersCard";
import { useT } from "../../i18n";
import { useProjectStore } from "../../store/project";
import { useProjectDocsStore } from "../../store/projectDocs";
import { type ProjectTab, useWorkspaceStore } from "../../store/workspace";
import { ProjectDocsPage } from "./ProjectDocsPage";

/** The open project's Claude documents, its settled decisions, and the forms new projects start from. */
export function ProjectPage() {
  const t = useT();
  const tab = useWorkspaceStore((s) => s.projectTab);
  const tabs: { value: ProjectTab; label: string }[] = [
    { value: "docs", label: t("project.tab.docs") },
    { value: "map", label: t("project.tab.map") },
    { value: "decisions", label: t("project.tab.decisions") },
    { value: "starters", label: t("project.tab.starters") },
  ];
  return (
    <div
      className={`mx-auto flex h-full flex-col px-10 pt-8 pb-10 ${tab === "docs" ? "max-w-6xl" : "max-w-3xl"}`}
    >
      <PageHeader title={t("shell.nav.project")} description={t("project.page.description")} />
      <div className="mb-8">
        <Tabs
          label={t("shell.nav.project")}
          value={tab}
          options={tabs}
          onChange={(v) => useWorkspaceStore.getState().goProject(v)}
        />
      </div>
      <div className="min-h-0 flex-1">
        {tab === "docs" ? (
          <ProjectDocsPage embedded />
        ) : tab === "map" ? (
          <ConfigMapPanel
            onManageMcp={() => {
              useWorkspaceStore.getState().setToolsTab("mcp");
              useWorkspaceStore.getState().go("tools");
            }}
            onEdit={async (rel) => {
              const docs = useProjectDocsStore.getState();
              await docs.load(useProjectStore.getState().current);
              if (await docs.open(rel)) useWorkspaceStore.getState().goProject("docs");
            }}
          />
        ) : tab === "decisions" ? (
          <DecisionsPanel />
        ) : (
          <StartersCard />
        )}
      </div>
    </div>
  );
}
