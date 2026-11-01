import { type MessageKey, useT } from "../i18n";
import { type TabId, useUiStore } from "../store/ui";

const TABS: { id: TabId; label: MessageKey }[] = [
  { id: "live", label: "shell.tab.live" },
  { id: "suggest", label: "shell.tab.suggest" },
  { id: "memo", label: "shell.tab.memo" },
  { id: "docs", label: "shell.tab.docs" },
];

export function TabNav() {
  const activeTab = useUiStore((s) => s.activeTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const t = useT();

  return (
    <div role="tablist" className="flex shrink-0 gap-4 px-4">
      {TABS.map((tab) => {
        const selected = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => setActiveTab(tab.id)}
            className={`relative py-2 text-fs-13 transition-colors ${
              selected ? "font-medium text-text" : "text-text-muted hover:text-text"
            }`}
          >
            {t(tab.label)}
            {selected && (
              <span className="absolute right-0 bottom-0 left-0 h-0.5 rounded-full bg-accent" />
            )}
          </button>
        );
      })}
    </div>
  );
}
