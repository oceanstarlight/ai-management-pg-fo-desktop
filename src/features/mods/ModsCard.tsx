import { invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Row, Segmented, Switch } from "../../components/ui";
import { type MessageKey, useT } from "../../i18n";
import { type ModStatus, OWN_MOD } from "../../store/connection";
import { AUTO_DOCK_PREF, AUTO_PREF, useSwitchPref } from "../../store/live";
import { getPref, onPrefChanged, setPref } from "../../store/prefs";

const OWN = OWN_MOD;

// Mirrors `McpStatus` in src-tauri/src/claude_mod.rs.
interface McpStatus {
  claudeFound: boolean;
  registered: boolean;
  current: boolean;
}

/**
 * Mods the app can install, checked against their repositories (licenses in
 * docs/research.md). The ids must match `RECOMMENDED` in claude_mod.rs.
 */
const RECOMMENDED: {
  id: string;
  name: string;
  description: MessageKey;
  url: string;
  license: string;
  note?: MessageKey;
}[] = [
  {
    id: "token-weather@claude-code-playground-mods",
    name: "token-weather",
    description: "mods.rec.tokenWeather",
    url: "https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/token-weather",
    license: "Apache-2.0",
  },
  {
    id: "blast-radius@claude-code-playground-mods",
    name: "blast-radius",
    description: "mods.rec.blastRadius",
    url: "https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/blast-radius",
    license: "Apache-2.0",
  },
  {
    id: "replay-theater@claude-code-playground-mods",
    name: "replay-theater",
    description: "mods.rec.replayTheater",
    url: "https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/replay-theater",
    license: "Apache-2.0",
  },
  {
    id: "claude-hud@claude-hud",
    name: "claude-hud",
    description: "mods.rec.claudeHud",
    url: "https://github.com/jarrodwatts/claude-hud",
    license: "MIT",
    note: "mods.rec.claudeHudNote",
  },
];

const open = (url: string) => {
  if (isTauri()) void openUrl(url);
  else window.open(url, "_blank");
};

/** Settings card: the app's own Claude Code mod and recommended ones. */
const SUGGEST_PREF = "promptSuggest";
type SuggestMode = "ai" | "keyword" | "off";

function readSuggestMode(): SuggestMode {
  const v = getPref(SUGGEST_PREF);
  return v === "keyword" || v === "off" ? v : "ai";
}

/** How the mod suggests skills and extensions while the user types a prompt. */
function AutoRows() {
  const t = useT();
  const [auto, setAuto] = useSwitchPref(AUTO_PREF, false);
  const [dock, setDock] = useSwitchPref(AUTO_DOCK_PREF, true);
  return (
    <>
      <Row title={t("mods.suggest.auto")} description={t("mods.suggest.autoDescription")}>
        <Switch checked={auto} onChange={setAuto} label={t("mods.suggest.auto")} />
      </Row>
      <Row title={t("mods.autoDock")} description={t("mods.autoDockDescription")}>
        <Switch checked={dock} onChange={setDock} label={t("mods.autoDock")} />
      </Row>
    </>
  );
}

function SuggestRow() {
  const t = useT();
  const [mode, setMode] = useState<SuggestMode>(readSuggestMode);
  useEffect(() => onPrefChanged(SUGGEST_PREF, () => setMode(readSuggestMode())), []);
  return (
    <Row title={t("mods.suggest.title")} description={t("mods.suggest.description")}>
      <Segmented
        label={t("mods.suggest.title")}
        value={mode}
        options={[
          { value: "ai", label: t("mods.suggest.ai") },
          { value: "keyword", label: t("mods.suggest.keyword") },
          { value: "off", label: t("mods.suggest.off") },
        ]}
        onChange={(v) => {
          setMode(v);
          setPref(SUGGEST_PREF, v);
        }}
      />
    </Row>
  );
}

export function ModsCard() {
  const t = useT();
  const [status, setStatus] = useState<ModStatus | null>(null);
  const [mcp, setMcp] = useState<McpStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const reload = useCallback(async () => {
    if (!isTauri()) return;
    const [mods, server] = await Promise.all([
      invoke<ModStatus>("claude_mod_status"),
      invoke<McpStatus>("mcp_bridge_status"),
    ]);
    setStatus(mods);
    setMcp(server);
  }, []);

  const runMcp = async (connect: boolean) => {
    setBusy("mcp");
    setMessage(null);
    try {
      await invoke(connect ? "mcp_bridge_connect" : "mcp_bridge_disconnect");
      setMessage({ text: t(connect ? "mods.mcp.done" : "mods.mcp.removed"), error: false });
    } catch (e) {
      setMessage({ text: String(e), error: true });
    }
    setBusy(null);
    await reload();
  };

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (id: string, install: boolean) => {
    setBusy(id);
    setMessage(null);
    try {
      if (!install) await invoke("claude_mod_uninstall", { id });
      else if (id === OWN) await invoke("claude_mod_install");
      else await invoke("claude_mod_install_recommended", { id });
      setMessage({ text: t(install ? "mods.installed" : "mods.uninstalled"), error: false });
    } catch (e) {
      setMessage({ text: String(e), error: true });
    }
    setBusy(null);
    await reload();
  };

  const ready = !!status?.claudeVersion && status.supported;
  const toggle = (id: string) => {
    const installed = status?.installed.includes(id) ?? false;
    return (
      <Button
        size="sm"
        variant={installed ? "secondary" : "primary"}
        disabled={!ready || busy !== null}
        onClick={() => void run(id, !installed)}
      >
        {busy === id ? t("mods.working") : t(installed ? "mods.uninstall" : "mods.install")}
      </Button>
    );
  };

  return (
    <Card title={t("mods.title")}>
      <p className="px-4 pt-3 text-xs text-text-muted">{t("mods.scope")}</p>
      <Row
        title={t("mods.claude")}
        description={
          !status
            ? t("mods.checking")
            : !status.claudeVersion
              ? t("mods.noClaude")
              : !status.supported
                ? t("mods.tooOld", { version: status.claudeVersion })
                : status.claudeVersion
        }
      >
        <Button size="sm" variant="ghost" onClick={() => void reload()}>
          {t("mods.recheck")}
        </Button>
      </Row>
      <Row title={t("mods.own.title")} description={t("mods.own.description")}>
        <div className="flex gap-1.5">
          {status?.ownOutdated && (
            <Button
              size="sm"
              variant="primary"
              disabled={!ready || busy !== null}
              onClick={() => void run(OWN, true)}
            >
              {busy === OWN ? t("mods.working") : t("mods.update")}
            </Button>
          )}
          {toggle(OWN)}
        </div>
      </Row>
      <SuggestRow />
      <AutoRows />
      <Row
        title={
          <span className="flex items-center gap-1.5">
            {t("mods.mcp.title")}
            {mcp?.registered && (
              <span
                className={`text-fs-11 font-normal ${mcp.current ? "text-success" : "text-warning"}`}
              >
                {mcp.current ? t("mods.mcp.connected") : t("mods.mcp.outdated")}
              </span>
            )}
          </span>
        }
        description={t("mods.mcp.description")}
      >
        <div className="flex gap-1.5">
          {mcp?.registered && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => void runMcp(false)}
            >
              {t("mods.mcp.disconnect")}
            </Button>
          )}
          {!mcp?.current && (
            <Button
              size="sm"
              variant="primary"
              disabled={!mcp?.claudeFound || busy !== null}
              onClick={() => void runMcp(true)}
            >
              {busy === "mcp"
                ? t("mods.working")
                : t(mcp?.registered ? "mods.mcp.reconnect" : "mods.mcp.connect")}
            </Button>
          )}
        </div>
      </Row>
      {message && (
        <p
          className={`selectable px-4 py-2 text-xs whitespace-pre-wrap ${message.error ? "text-danger" : "text-text-muted"}`}
        >
          {message.text}
        </p>
      )}
      <p className="px-4 pt-3 text-xs font-semibold text-text-muted">{t("mods.recommended")}</p>
      {RECOMMENDED.map((m) => (
        <Row
          key={m.id}
          title={
            <span className="flex items-center gap-1.5">
              {m.name}
              <button
                type="button"
                onClick={() => open(m.url)}
                title={m.url}
                className="flex items-center gap-0.5 text-fs-11 font-normal text-text-subtle hover:text-text"
              >
                {m.license}
                <ExternalLink size={10} />
              </button>
            </span>
          }
          description={
            <>
              {t(m.description)}
              {m.note && <span className="block text-text-subtle">{t(m.note)}</span>}
            </>
          }
        >
          {toggle(m.id)}
        </Row>
      ))}
    </Card>
  );
}
