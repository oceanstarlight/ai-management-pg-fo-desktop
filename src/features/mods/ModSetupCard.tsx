import { invoke, isTauri } from "@tauri-apps/api/core";
import { Plug } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { useT } from "../../i18n";
import { type ModStatus, OWN } from "./ModsCard";

/** Asks to install (or update) the app's own mod, which live detection needs.
 * Renders `fallback` when the mod is installed and current. */
export function ModSetupCard({ fallback }: { fallback: React.ReactNode }) {
  const t = useT();
  const [status, setStatus] = useState<ModStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);

  const reload = useCallback(async () => {
    if (!isTauri()) return;
    setStatus(await invoke<ModStatus>("claude_mod_status").catch(() => null));
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const installed = status?.installed.includes(OWN) ?? false;
  if (!status || (installed && !status.ownOutdated)) return <>{fallback}</>;

  const ready = !!status.claudeVersion && status.supported;
  const install = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await invoke("claude_mod_install");
      setNotice({ text: t("mods.installed") });
    } catch (e) {
      setNotice({ text: String(e), bad: true });
    }
    setBusy(false);
    await reload();
  };

  return (
    <div className="rounded-xl border border-accent/40 bg-surface-raised px-4 py-3">
      <div className="flex items-center gap-2 text-fs-13 font-semibold text-text">
        <Plug size={14} className="text-accent" />
        {t(installed ? "mods.own.title" : "suggest.setup.title")}
      </div>
      <p className="mt-1 text-fs-12 text-text-muted">
        {!status.claudeVersion
          ? t("mods.noClaude")
          : !status.supported
            ? t("mods.tooOld", { version: status.claudeVersion })
            : t(installed ? "suggest.setup.outdated" : "suggest.setup.description")}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={!ready || busy}
          onClick={() => void install()}
        >
          {busy
            ? t("mods.working")
            : t(installed ? "suggest.setup.update" : "suggest.setup.install")}
        </Button>
        {!ready && (
          <Button size="sm" variant="ghost" onClick={() => void reload()}>
            {t("mods.recheck")}
          </Button>
        )}
      </div>
      {notice && (
        <p className={`selectable mt-1 text-fs-12 ${notice.bad ? "text-danger" : "text-success"}`}>
          {notice.text}
        </p>
      )}
    </div>
  );
}
