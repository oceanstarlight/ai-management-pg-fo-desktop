import { useState } from "react";
import { Button } from "../../components/ui";
import { type MessageKey, useT } from "../../i18n";
import { type HubServerStatus, useHubStore } from "../../store/hub";

/**
 * `plugin`: the npm package's `encela` plugin serves the hub (same modules
 * file), so the app's registration isn't needed; `both`: it is still there
 * too, and Claude sees every hub tool twice.
 */
export type GatewayState = "connected" | "stale" | "off" | "noClaude" | "plugin" | "both";

export function gatewayState(server: HubServerStatus | null): GatewayState | null {
  if (!server) return null;
  if (!server.claudeFound) return "noClaude";
  if (server.plugin) return server.registered ? "both" : "plugin";
  if (server.registered && server.current) return "connected";
  return server.registered ? "stale" : "off";
}

/** Claude Code has a hub, the app's or the plugin's. */
export const hubReady = (server: HubServerStatus | null) =>
  !!server && (server.plugin || server.registered);

export const GATEWAY_DOT: Record<GatewayState, string> = {
  connected: "bg-success",
  stale: "bg-warning",
  off: "bg-border-strong",
  noClaude: "bg-border-strong",
  plugin: "bg-success",
  both: "bg-warning",
};

/** encela-hub in Claude Code: connected or not, and how many modules it offers. */
export function Gateway({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const server = useHubStore((s) => s.server);
  const count = useHubStore((s) => s.entries.filter((e) => e.inHub).length);
  const combos = useHubStore((s) => s.combos.length);
  const { connectServer, disconnectServer } = useHubStore.getState();
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    await f();
    setBusy(false);
  };
  const state = gatewayState(server);
  return (
    <section>
      <div className="flex items-center gap-2">
        <h3 className="text-fs-11 font-medium tracking-wide text-text-subtle">
          {t("hub.gateway.title")} <span className="font-mono font-normal">encela-hub</span>
        </h3>
        <span className="text-fs-11 text-text-subtle">
          · {t("adaptive.gateway.count", { modules: count, combos })}
        </span>
      </div>
      {!compact && (
        <p className="mt-0.5 mb-2 text-fs-11 leading-snug text-text-muted">
          {t("adaptive.gateway.hint")}
        </p>
      )}
      {state && (
        <div className="mt-1 flex items-center gap-2 text-xs">
          <span className={`size-2 shrink-0 rounded-full ${GATEWAY_DOT[state]}`} />
          <span className="text-text-muted">{t(`hub.gateway.${state}` as MessageKey)}</span>
          {state === "both" && (
            <span className="ml-auto flex gap-1.5">
              <Button size="sm" disabled={busy} onClick={() => void run(disconnectServer)}>
                {t("hub.gateway.dropApp")}
              </Button>
            </span>
          )}
          {state !== "noClaude" && state !== "plugin" && state !== "both" && (
            <span className="ml-auto flex gap-1.5">
              {state !== "connected" && (
                <Button size="sm" disabled={busy} onClick={() => void run(connectServer)}>
                  {t(state === "stale" ? "hub.gateway.reconnect" : "hub.gateway.connect")}
                </Button>
              )}
              {state !== "off" && !compact && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run(disconnectServer)}
                >
                  {t("hub.gateway.disconnect")}
                </Button>
              )}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
