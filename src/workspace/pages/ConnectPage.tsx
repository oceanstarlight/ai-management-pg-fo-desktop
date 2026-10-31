import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Cloud, ExternalLink, Monitor } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button, Switch } from "../../components/ui";
import { type MessageKey, timeAgo, useT } from "../../i18n";
import { useAccountStore } from "../../store/account";
import { modReady, OWN_MOD, useConnectionStore } from "../../store/connection";
import { AUTO_DOCK_PREF, useLiveStore, useSwitchPref } from "../../store/live";
import { useProjectStore } from "../../store/project";

const CLAUDE_CODE_DOCS = "https://docs.claude.com/en/docs/claude-code";
const CLAUDE_CODE_WEB = "https://claude.ai/code";

const base = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** Everything needed for Encela to see Claude Code, as two checklists. */
export function ConnectPage() {
  const t = useT();
  const load = useConnectionStore((s) => s.load);
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => {
    void load();
    useLiveStore.getState().init();
  }, [load]);

  const run = async (f: () => Promise<unknown>, done?: string) => {
    setNotice(null);
    try {
      await f();
      if (done) setNotice({ text: done });
    } catch (e) {
      setNotice({ text: String(e), bad: true });
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="font-serif text-fs-28 leading-tight font-medium tracking-tight">
        {t("connect.title")}
      </h1>
      <p className="mt-2 mb-8 max-w-2xl text-sm text-text-muted">{t("connect.description")}</p>
      <div className="space-y-8">
        <LocalSection run={run} />
        <CloudSection run={run} />
      </div>
      {notice && (
        <p className={`selectable mt-4 text-fs-13 ${notice.bad ? "text-danger" : "text-success"}`}>
          {notice.text}
        </p>
      )}
    </div>
  );
}

type Run = (f: () => Promise<unknown>, done?: string) => Promise<void>;

function LocalSection({ run }: { run: Run }) {
  const t = useT();
  const { mod, loadMod, installMod } = useConnectionStore();
  const sessions = useLiveStore((s) => s.sessions);
  const [dock, setDock] = useSwitchPref(AUTO_DOCK_PREF, true);
  const [busy, setBusy] = useState(false);

  const claudeOk = !!mod?.claudeVersion && mod.supported;
  const installed = mod?.installed.includes(OWN_MOD) ?? false;
  const local = sessions.find((s) => s.surface !== "cloud");
  const steps = [claudeOk, modReady(mod), !!local];

  return (
    <Section
      icon={<Monitor size={16} />}
      title={t("connect.local.title")}
      subtitle={t("connect.local.subtitle")}
      steps={steps}
    >
      <Step
        n={1}
        done={claudeOk}
        title={t("connect.local.claude")}
        description={
          !mod
            ? t("mods.checking")
            : !mod.claudeVersion
              ? t("mods.noClaude")
              : !mod.supported
                ? t("mods.tooOld", { version: mod.claudeVersion })
                : t("connect.local.claudeOk", { version: mod.claudeVersion })
        }
      >
        {!claudeOk && (
          <>
            <Button size="sm" variant="ghost" onClick={() => void openUrl(CLAUDE_CODE_DOCS)}>
              <ExternalLink size={13} />
              {t("connect.local.claudeGuide")}
            </Button>
            <Button size="sm" onClick={() => void loadMod()}>
              {t("connect.recheck")}
            </Button>
          </>
        )}
      </Step>
      <Step
        n={2}
        done={steps[1]}
        title={t("connect.local.mod")}
        description={
          steps[1]
            ? t("connect.local.modOk")
            : t(installed ? "suggest.setup.outdated" : "suggest.setup.description")
        }
      >
        {!steps[1] && (
          <Button
            size="sm"
            variant="primary"
            disabled={!claudeOk || busy}
            onClick={async () => {
              setBusy(true);
              await run(installMod, t("mods.installed"));
              setBusy(false);
            }}
          >
            {busy
              ? t("mods.working")
              : t(installed ? "suggest.setup.update" : "suggest.setup.install")}
          </Button>
        )}
      </Step>
      <Step
        n={3}
        done={!!local}
        title={t("connect.local.run")}
        description={
          local
            ? t("connect.local.runOk", { project: base(local.project) || local.surface })
            : t("connect.local.runHint")
        }
      >
        <div className="flex items-center gap-2 text-fs-12 text-text-muted">
          {t("connect.local.autoDock")}
          <Switch checked={dock} onChange={setDock} label={t("connect.local.autoDock")} />
        </div>
      </Step>
    </Section>
  );
}

function CloudSection({ run }: { run: Run }) {
  const t = useT();
  const account = useAccountStore((s) => s.info);
  const openAccount = useAccountStore((s) => s.openDialog);
  const { relay, setRelay } = useConnectionStore();
  const project = useProjectStore((s) => s.current);
  const [busy, setBusy] = useState(false);

  const signedIn = !!account?.uid;
  const on = !!relay?.enabled;
  const received = relay?.lastEvent ?? null;
  const steps = [signedIn, on, !!received, !!received];
  const who = account?.profile?.email ?? account?.profile?.name ?? "";

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    await run(() => setRelay(enabled));
    setBusy(false);
  };

  return (
    <Section
      icon={<Cloud size={16} />}
      title={t("connect.cloud.title")}
      subtitle={t("connect.cloud.subtitle")}
      steps={steps}
    >
      <Step
        n={1}
        done={signedIn}
        title={t("connect.cloud.account")}
        description={
          signedIn ? t("connect.cloud.accountOk", { who }) : t("connect.cloud.accountHint")
        }
      >
        {!signedIn && (
          <Button size="sm" variant="primary" onClick={openAccount}>
            {t("connect.cloud.signIn")}
          </Button>
        )}
      </Step>
      <Step
        n={2}
        done={on}
        title={t("connect.cloud.enable")}
        description={
          relay?.state === "error" && relay.message
            ? relay.message
            : t(
                on
                  ? (`relay.state.${relay?.state ?? "ok"}` as MessageKey)
                  : "connect.cloud.enableHint",
              )
        }
        bad={relay?.state === "error"}
      >
        <Switch
          checked={on}
          disabled={!signedIn || busy}
          onChange={(v) => void toggle(v)}
          label={t("connect.cloud.enable")}
        />
      </Step>
      <Step
        n={3}
        done={!!received}
        title={t("connect.cloud.script")}
        description={t("connect.cloud.scriptHint")}
      >
        <div className="flex flex-col items-end gap-1.5">
          <Button
            size="sm"
            variant="primary"
            disabled={!on}
            onClick={() =>
              void run(async () => {
                const script = await invoke<string>("relay_setup_script");
                await navigator.clipboard.writeText(script);
              }, t("connect.cloud.copied"))
            }
          >
            {t("connect.cloud.copyScript")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void openUrl(CLAUDE_CODE_WEB)}>
            <ExternalLink size={13} />
            {t("connect.cloud.openWeb")}
          </Button>
        </div>
      </Step>
      <Step
        n={4}
        done={!!received}
        title={t("connect.cloud.test")}
        description={
          received
            ? t("connect.cloud.testOk", { time: timeAgo(received / 1000) })
            : t("connect.cloud.testHint")
        }
      />

      {on && (
        <details className="px-4 py-3 text-fs-12 text-text-muted">
          <summary className="cursor-pointer font-medium text-text">
            {t("connect.cloud.advanced")}
          </summary>
          <p className="mt-1.5">{t("connect.cloud.advancedHint")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button
              size="sm"
              disabled={!project}
              onClick={() =>
                project &&
                void run(() => invoke("relay_install_hook", { project }), t("relay.hookDone"))
              }
            >
              {t("relay.hookInstall")}
              {project && ` · ${base(project)}`}
            </Button>
            <Button
              size="sm"
              onClick={() =>
                void run(
                  () => navigator.clipboard.writeText(`ENCELA_RELAY=${relay?.token ?? ""}`),
                  t("relay.copied"),
                )
              }
            >
              {t("relay.copy")}
            </Button>
          </div>
          <p className="mt-2">{t("relay.limits")}</p>
        </details>
      )}
    </Section>
  );
}

function Section({
  icon,
  title,
  subtitle,
  steps,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  steps: boolean[];
  children: ReactNode;
}) {
  const t = useT();
  const left = steps.filter((d) => !d).length;
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="text-text-muted">{icon}</span>
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-fs-12 text-text-subtle">{subtitle}</span>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-fs-11 font-medium ${
            left === 0 ? "bg-success/15 text-success" : "bg-sunken text-text-muted"
          }`}
        >
          {left === 0 ? t("connect.done") : t("connect.todo", { n: left })}
        </span>
      </div>
      <div className="divide-y divide-border rounded-xl border border-border bg-surface-raised">
        {children}
      </div>
    </section>
  );
}

function Step({
  n,
  done,
  title,
  description,
  bad = false,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  description: string;
  bad?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span
        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-fs-12 font-semibold ${
          done ? "bg-success text-accent-fg" : "border border-border-strong text-text-muted"
        }`}
      >
        {done ? <Check size={13} strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <p className={`selectable mt-0.5 text-fs-12 ${bad ? "text-danger" : "text-text-muted"}`}>
          {description}
        </p>
      </div>
      {children && <div className="flex shrink-0 items-center gap-1.5">{children}</div>}
    </div>
  );
}
