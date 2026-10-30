import { ChevronLeft, FileText } from "lucide-react";
import { useEffect } from "react";
import { Button } from "../../components/ui";
import { useT } from "../../i18n";
import { useProjectStore } from "../../store/project";
import { type DocKind, useProjectDocsStore } from "../../store/projectDocs";
import { useUiStore } from "../../store/ui";
import { DocEditor } from "../../workspace/pages/ProjectDocsPage";
import { DecisionsPanel } from "../suggest/DecisionsPanel";

/** Documents Claude Code reads, worth editing by hand. */
const EDITABLE: DocKind[] = ["instructions", "rule", "skill", "agent", "command"];

/** The sidebar's editor: the project's CLAUDE.md, rules, skills, subagents and commands. */
export function DocEditPanel() {
  const t = useT();
  const project = useProjectStore((s) => s.current);
  const { entries, rel, load, open, close } = useProjectDocsStore();

  useEffect(() => {
    void load(project, "claude");
  }, [project, load]);

  if (!project) {
    return (
      <div className="space-y-2">
        <p className="text-fs-12 text-text-muted">{t("docs.edit.noProject")}</p>
        <Button size="sm" onClick={() => useUiStore.getState().setActiveTab("work")}>
          {t("shell.tab.work")}
        </Button>
      </div>
    );
  }

  if (rel) {
    return (
      <div className="flex flex-col gap-2">
        <Button size="sm" variant="ghost" className="self-start" onClick={() => close()}>
          <ChevronLeft size={13} />
          {t("docs.edit.back")}
        </Button>
        <DocEditor project={project} />
      </div>
    );
  }

  const docs = entries.filter((e) => EDITABLE.includes(e.kind));
  return (
    <div className="space-y-4">
      {docs.length === 0 ? (
        <p className="text-fs-12 text-text-muted">{t("docs.edit.empty")}</p>
      ) : (
        <ul className="space-y-px">
          {docs.map((d) => (
            <li key={d.rel}>
              <button
                type="button"
                onClick={() => void open(d.rel)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-fs-12 hover:bg-hover"
              >
                <FileText size={13} className="shrink-0 text-text-subtle" />
                <span className="min-w-0 flex-1 truncate font-mono">{d.rel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <DecisionsPanel compact />
    </div>
  );
}
