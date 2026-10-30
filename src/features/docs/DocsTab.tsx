import { useState } from "react";
import { type MessageKey, useT } from "../../i18n";
import { ConfigMapPanel } from "./ConfigMapPanel";
import { DocEditPanel } from "./DocEditPanel";
import { LibraryPanel } from "./LibraryPanel";

type View = "edit" | "map" | "library";

const VIEWS: { id: View; label: MessageKey }[] = [
  { id: "edit", label: "docs.view.edit" },
  { id: "map", label: "docs.view.map" },
  { id: "library", label: "docs.view.library" },
];

export function DocsTab() {
  const t = useT();
  const [view, setView] = useState<View>("edit");
  return (
    <div className="space-y-3">
      <div className="flex rounded-md border border-border p-0.5 text-xs">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={view === v.id}
            onClick={() => setView(v.id)}
            className={`flex-1 rounded py-1 ${view === v.id ? "bg-surface-raised font-semibold" : "text-text-muted hover:text-text"}`}
          >
            {t(v.label)}
          </button>
        ))}
      </div>
      {view === "edit" ? <DocEditPanel /> : view === "map" ? <ConfigMapPanel /> : <LibraryPanel />}
    </div>
  );
}
