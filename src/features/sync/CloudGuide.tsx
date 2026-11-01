import { invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, ChevronDown, Copy, ExternalLink, Plus, Settings2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button, Segmented } from "../../components/ui";
import { useT } from "../../i18n";

const CLAUDE_CODE_WEB = "https://claude.ai/code";
const ENV_DOCS = "https://code.claude.com/docs/en/cloud-environments";

type Where = "app" | "cli";

/**
 * How to put the setup script into a cloud environment, step by step with a
 * sketch of the screen for each: in the desktop app or claude.ai/code, or from
 * the terminal (which can pick an environment but not edit one).
 */
export function CloudGuide({ enabled, onCopy }: { enabled: boolean; onCopy: () => void }) {
  const t = useT();
  const [where, setWhere] = useState<Where>("app");
  const host = useRelayHost();

  const copyStep = (
    <GuideStep n={1} text={t("guide.copy")}>
      <Button size="sm" variant="primary" disabled={!enabled} onClick={onCopy}>
        <Copy size={13} />
        {t("connect.cloud.copyScript")}
      </Button>
      {!enabled && <span className="text-fs-11 text-text-subtle">{t("guide.copyOff")}</span>}
    </GuideStep>
  );

  return (
    <div className="mt-3 space-y-4">
      <Segmented
        label={t("guide.where")}
        value={where}
        options={[
          { value: "app", label: t("guide.where.app") },
          { value: "cli", label: t("guide.where.cli") },
        ]}
        onChange={(v) => setWhere(v as Where)}
      />
      {where === "app" ? (
        <ol className="space-y-5">
          {copyStep}
          <AppSteps from={2} host={host} />
        </ol>
      ) : (
        <ol className="space-y-5">
          {copyStep}
          <GuideStep n={2} text={t("guide.cli.setup")}>
            <Terminal lines={["/web-setup"]} />
          </GuideStep>
          <GuideStep n={3} text={t("guide.cli.edit")}>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" onClick={() => setWhere("app")}>
                {t("guide.cli.showApp")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void openUrl(CLAUDE_CODE_WEB)}>
                <ExternalLink size={13} />
                {t("connect.cloud.openWeb")}
              </Button>
            </div>
          </GuideStep>
          <GuideStep n={4} text={t("guide.cli.pick")}>
            <Terminal lines={["/remote-env"]} note={t("guide.cli.pickNote")} />
          </GuideStep>
          <GuideStep n={5} text={t("guide.cli.run")}>
            <Terminal lines={[`claude --cloud "${t("guide.cli.runExample")}"`]} />
          </GuideStep>
        </ol>
      )}
      <p className="text-fs-11 text-text-subtle">
        {t("guide.secret")}{" "}
        <button
          type="button"
          className="underline hover:text-text"
          onClick={() => void openUrl(ENV_DOCS)}
        >
          {t("guide.docs")}
        </button>
      </p>
    </div>
  );
}

/** The database host to allow, from the backend (the build's own project). */
function useRelayHost(): string {
  const [host, setHost] = useState("<project>-default-rtdb.firebaseio.com");
  useEffect(() => {
    if (!isTauri()) return;
    void invoke<string | null>("relay_host").then(
      (h) => h && setHost(h),
      () => {},
    );
  }, []);
  return host;
}

/** Editing the environment, in the desktop app or at claude.ai/code. */
function AppSteps({ from, host }: { from: number; host: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <>
      <GuideStep n={from} text={t("guide.app.open")}>
        <ShotNewSession />
      </GuideStep>
      <GuideStep n={from + 1} text={t("guide.app.gear")} note={t("guide.app.gearNote")}>
        <ShotEnvMenu />
      </GuideStep>
      <GuideStep n={from + 2} text={t("guide.app.script")}>
        <ShotDialog focus="script" />
      </GuideStep>
      <GuideStep n={from + 3} text={t("guide.app.network")} note={t("guide.app.networkNote")}>
        <ShotDialog focus="network" host={host} />
        <Button
          size="sm"
          onClick={() =>
            void navigator.clipboard.writeText(host).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span className="font-mono text-fs-11">{host}</span>
        </Button>
      </GuideStep>
      <GuideStep n={from + 4} text={t("guide.app.save")}>
        <ShotDialog focus="save" />
      </GuideStep>
    </>
  );
}

function GuideStep({
  n,
  text,
  note,
  children,
}: {
  n: number;
  text: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-sunken text-fs-11 font-semibold text-text-muted">
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-fs-13">{text}</p>
        {note && <p className="text-fs-11 text-text-subtle">{note}</p>}
        {children && <div className="flex flex-wrap items-start gap-2">{children}</div>}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Sketches of the screens: plain shapes with the control to use ringed. The
// labels are the ones Claude Code shows (it is in English).

const ring = "ring-2 ring-accent ring-offset-1 ring-offset-sunken";

function Shot({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div
      aria-hidden
      className={`rounded-lg border border-border bg-sunken p-3 text-fs-11 text-text-muted ${
        wide ? "w-full max-w-md" : "w-72"
      }`}
    >
      {children}
    </div>
  );
}

function ShotNewSession() {
  return (
    <Shot wide>
      <div className="rounded-md border border-border bg-surface px-2.5 py-2 text-text-subtle">
        Find a small todo in the codebase and do it…
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <span className={`flex items-center gap-1 rounded-md bg-surface px-2 py-1 ${ring}`}>
          Default <ChevronDown size={11} />
        </span>
        <span className="rounded-md bg-surface px-2 py-1">repo</span>
        <span className="rounded-md bg-surface px-2 py-1">branch</span>
      </div>
    </Shot>
  );
}

function ShotEnvMenu() {
  return (
    <Shot>
      <div className="rounded-md border border-border bg-surface py-1">
        <div className="px-2.5 py-1 text-fs-10.5 font-medium text-text-subtle">Cloud</div>
        <div className="flex items-center gap-2 bg-hover px-2.5 py-1.5 text-text">
          <span className="flex-1">Default</span>
          <span className={`rounded p-0.5 ${ring}`}>
            <Settings2 size={12} />
          </span>
        </div>
        <div className="px-2.5 py-1.5">My environment</div>
        <div className="mt-1 flex items-center gap-1.5 border-t border-border px-2.5 pt-1.5">
          <Plus size={11} /> New environment
        </div>
      </div>
    </Shot>
  );
}

function ShotDialog({ focus, host }: { focus: "script" | "network" | "save"; host?: string }) {
  const row = (on: boolean) =>
    `flex items-center justify-between rounded-md bg-surface px-2.5 py-1.5 ${on ? ring : ""}`;
  return (
    <Shot wide>
      <div className="mb-2 font-medium text-text">Edit cloud environment</div>
      <div className="space-y-1.5">
        <div className={row(focus === "network")}>
          <span>Network access</span>
          <span className="flex items-center gap-1 text-text">
            {focus === "network" ? "Custom" : "Trusted"} <ChevronDown size={11} />
          </span>
        </div>
        {focus === "network" && (
          <div className="rounded-md bg-surface px-2.5 py-1.5">
            <div className="text-fs-10.5 text-text-subtle">Allowed domains</div>
            <div className="mt-1 rounded border border-accent/60 px-1.5 py-1 font-mono text-text">
              {host}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="flex size-3 items-center justify-center rounded-sm bg-accent text-accent-fg">
                <Check size={9} strokeWidth={3} />
              </span>
              Also include default list of common package managers
            </div>
          </div>
        )}
        <div className={row(focus === "script")}>
          <span>Setup script</span>
          <span className="text-text-subtle">›</span>
        </div>
        {focus === "script" && (
          <div className="rounded-md bg-surface px-2.5 py-1.5 font-mono leading-relaxed">
            <div className="text-text-subtle">#!/bin/bash</div>
            <div className="text-text-subtle">…</div>
            <div className="rounded bg-accent/15 px-1 text-text"># encela relay …</div>
          </div>
        )}
        <div className={row(false)}>
          <span>Environment variables</span>
          <span className="text-text-subtle">›</span>
        </div>
      </div>
      <div className="mt-2.5 flex justify-end">
        <span
          className={`rounded-md bg-primary px-2.5 py-1 text-primary-fg ${focus === "save" ? ring : ""}`}
        >
          Save changes
        </span>
      </div>
    </Shot>
  );
}

function Terminal({ lines, note }: { lines: string[]; note?: string }) {
  return (
    <div className="w-full max-w-md rounded-lg bg-sunken px-3 py-2.5 font-mono text-fs-12">
      {lines.map((line) => (
        <div key={line} className="selectable flex gap-2">
          <span className="text-text-subtle">›</span>
          <span className="text-text">{line}</span>
        </div>
      ))}
      {note && <div className="mt-1 font-sans text-fs-11 text-text-subtle">{note}</div>}
    </div>
  );
}
