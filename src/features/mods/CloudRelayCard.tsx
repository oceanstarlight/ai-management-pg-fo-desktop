import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { Button, Card, Row, Switch } from "../../components/ui";
import { type MessageKey, timeAgo, useT } from "../../i18n";
import { useProjectStore } from "../../store/project";

// Mirrors `Status` in src-tauri/src/sync/relay.rs.
interface RelayStatus {
  enabled: boolean;
  token: string | null;
  state: "off" | "needsSignIn" | "notAllowed" | "ok" | "error";
  message: string | null;
  lastEvent: number | null;
}

/** Claude Code sessions in the cloud, relayed through the sync account. */
export function CloudRelayCard() {
  const t = useT();
  const project = useProjectStore((s) => s.current);
  const [status, setStatus] = useState<RelayStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<RelayStatus>("relay_status").then(setStatus);
    const off = listen<RelayStatus>("relay-status", (e) => setStatus(e.payload));
    return () => void off.then((f) => f());
  }, []);

  const run = async (f: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await f();
      if (done) setNotice({ text: done });
    } catch (e) {
      setNotice({ text: String(e), bad: true });
    }
    setBusy(false);
  };

  const state = status?.state ?? "off";
  const line = `ENCELA_RELAY=${status?.token ?? ""}`;
  return (
    <Card title={t("relay.title")}>
      <Row
        title={t("relay.enable")}
        description={
          state === "ok" && status?.lastEvent
            ? t("relay.lastEvent", { time: timeAgo(status.lastEvent / 1000) })
            : (status?.message ?? t(`relay.state.${state}` as MessageKey))
        }
      >
        <Switch
          checked={!!status?.enabled}
          disabled={busy}
          label={t("relay.enable")}
          onChange={(on) =>
            void run(async () => setStatus(await invoke("relay_set_enabled", { enabled: on })))
          }
        />
      </Row>
      {status?.enabled && status.token && (
        <>
          <Row title={t("relay.key")} description={t("relay.keyDescription")}>
            <Button
              size="sm"
              onClick={() =>
                void navigator.clipboard
                  .writeText(line)
                  .then(() => setNotice({ text: t("relay.copied") }))
                  .catch(() => {})
              }
            >
              {t("relay.copy")}
            </Button>
          </Row>
          <Row
            title={t("relay.hook")}
            description={project ? t("relay.hookDescription", { project }) : t("relay.noProject")}
          >
            <Button
              size="sm"
              disabled={!project || busy}
              onClick={() =>
                project &&
                void run(
                  () => invoke<string[]>("relay_install_hook", { project }),
                  t("relay.hookDone"),
                )
              }
            >
              {t("relay.hookInstall")}
            </Button>
          </Row>
        </>
      )}
      <div className="px-4 py-3 text-xs text-text-muted">
        <p className="font-medium text-text">{t("relay.stepsTitle")}</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4">
          <li>{t("relay.step1")}</li>
          <li>{t("relay.step2")}</li>
          <li>{t("relay.step3")}</li>
          <li>{t("relay.step4")}</li>
        </ol>
        <p className="mt-1.5">{t("relay.limits")}</p>
        {notice && (
          <p className={`selectable mt-1.5 ${notice.bad ? "text-danger" : "text-success"}`}>
            {notice.text}
          </p>
        )}
      </div>
    </Card>
  );
}
