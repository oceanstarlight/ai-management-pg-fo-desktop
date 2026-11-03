import { ShieldAlert } from "lucide-react";
import { useEffect } from "react";
import { Button } from "../../components/ui";
import { useT } from "../../i18n";
import { fitOf, hubCanRun, useHubStore } from "../../store/hub";
import { useWorkspaceStore } from "../../store/workspace";
import { FitMeter } from "./CombosPanel";
import { Gateway } from "./Gateway";
import { KindBadge } from "./ModulesPanel";

/** The sidebar's adaptive tools tab: the hub, combinations and modules at a glance. */
export function AdaptiveSidebar() {
  const t = useT();
  const entries = useHubStore((s) => s.entries);
  const combos = useHubStore((s) => s.combos);
  const loaded = useHubStore((s) => s.loaded);

  useEffect(() => {
    void useHubStore.getState().load();
    void useHubStore.getState().loadServer();
  }, []);

  return (
    <div className="space-y-6">
      <Gateway compact />

      <section>
        <h3 className="mb-1.5 text-fs-11 font-medium tracking-wide text-text-subtle">
          {t("adaptive.tab.combos")} <span className="font-normal">{combos.length}</span>
        </h3>
        {combos.length === 0 ? (
          <p className="text-fs-12 text-text-subtle">{t("adaptive.combos.emptyShort")}</p>
        ) : (
          <ul className="space-y-2">
            {combos.map((c) => (
              <li key={c.name}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-fs-13 font-medium">{c.name}</span>
                  <FitMeter fit={fitOf(c)} compact />
                </div>
                <p className="truncate text-fs-11 text-text-subtle">
                  {c.members.map((m) => m.module).join(" + ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-1.5 text-fs-11 font-medium tracking-wide text-text-subtle">
          {t("adaptive.tab.modules")} <span className="font-normal">{entries.length}</span>
        </h3>
        {loaded && entries.length === 0 ? (
          <p className="text-fs-12 text-text-subtle">{t("adaptive.modules.emptyShort")}</p>
        ) : (
          <ul className="space-y-1.5">
            {entries.map((e) => (
              <li key={e.name} className="flex items-center gap-2" title={e.description}>
                <span
                  className={`size-1.5 shrink-0 rounded-full ${
                    e.inHub && hubCanRun(e) ? "bg-accent" : "bg-border-strong"
                  }`}
                />
                <span className="min-w-0 flex-1 truncate text-fs-12">{e.name}</span>
                <KindBadge entry={e} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <Button size="sm" onClick={() => useWorkspaceStore.getState().go("adaptive")}>
        {t("adaptive.openMain")}
      </Button>
      <p className="flex items-start gap-1.5 text-fs-11 leading-snug text-text-subtle">
        <ShieldAlert size={12} className="mt-0.5 shrink-0" />
        {t("hub.security")}
      </p>
    </div>
  );
}
