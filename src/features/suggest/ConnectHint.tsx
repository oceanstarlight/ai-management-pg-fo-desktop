import { Cable } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { Button } from "../../components/ui";
import { useT } from "../../i18n";
import { modReady, useConnectionStore } from "../../store/connection";
import { openConnect } from "../../store/workspace";

/** Points to the connection page until Claude Code is connected one way or
 * the other; renders `fallback` once it is. */
export function ConnectHint({ fallback }: { fallback: ReactNode }) {
  const t = useT();
  const { mod, relay, load } = useConnectionStore();
  useEffect(() => {
    void load();
  }, [load]);

  if (!mod || !relay || modReady(mod) || relay.enabled) return <>{fallback}</>;
  return (
    <div className="rounded-xl border border-accent/40 bg-surface-raised px-4 py-3">
      <div className="flex items-center gap-2 text-fs-13 font-semibold text-text">
        <Cable size={14} className="text-accent" />
        {t("connect.hint.title")}
      </div>
      <p className="mt-1 text-fs-12 text-text-muted">{t("connect.hint.description")}</p>
      <Button size="sm" variant="primary" className="mt-2" onClick={() => void openConnect()}>
        {t("connect.hint.button")}
      </Button>
    </div>
  );
}
