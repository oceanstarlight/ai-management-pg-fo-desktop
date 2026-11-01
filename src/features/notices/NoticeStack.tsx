import { Bell, CloudOff, Download, type LucideIcon, PlugZap, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { Button } from "../../components/ui";
import { type MessageKey, useT } from "../../i18n";
import { useAccountStore } from "../../store/account";
import { modReady, OWN_MOD, useConnectionStore } from "../../store/connection";
import { useGitHubStore } from "../../store/github";
import { useNoticesStore } from "../../store/notices";
import { useSyncStore } from "../../store/sync";
import { useUpdaterStore } from "../../store/updater";
import { openConnect, useWorkspaceStore } from "../../store/workspace";
import { open } from "../work/useGitHubSync";

type Tone = "warning" | "danger" | "info";

export interface Notice {
  /** Stable for the same news; a different id is new news ("don't show again" is per id). */
  id: string;
  tone: Tone;
  icon: LucideIcon;
  title: string;
  body?: ReactNode;
  action?: { label: string; run: () => void; busy?: boolean };
  /**
   * `forever`: "Don't show again" (remembered by id unless `onClose` keeps
   * it). `close`: closes this one. Absent: stays until it is dealt with.
   */
  dismiss?: "forever" | "close";
  onClose?: () => void;
}

/** When each notice was first seen this run: newer ones stack on top of older ones. */
const firstSeen = new Map<string, number>();

/** Everything the app wants the user to know or do, from the stores' state. */
export function useNotices(): Notice[] {
  const t = useT();
  const mod = useConnectionStore((s) => s.mod);
  const relay = useConnectionStore((s) => s.relay);
  const installMod = useConnectionStore((s) => s.installMod);
  const openAccount = useAccountStore((s) => s.openDialog);
  const ghExpired = useGitHubStore((s) => s.expired);
  const ghLogin = useGitHubStore((s) => s.login);
  const ghLoginError = useGitHubStore((s) => s.loginError);
  const syncNotice = useSyncStore((s) => s.notice);
  const dismissSync = useSyncStore((s) => s.dismissNotice);
  const update = useUpdaterStore();
  const dismissed = useNoticesStore((s) => s.dismissed);

  const list: Notice[] = [];

  // Nothing connects Encela to Claude Code yet: until it does (not dismissable).
  const nothingConnected = !!mod && !!relay && !modReady(mod) && !relay.enabled;
  if (nothingConnected) {
    list.push({
      id: "setup",
      tone: "info",
      icon: PlugZap,
      title: t("notice.setup.title"),
      body: t("notice.setup.body"),
      action: { label: t("notice.setup.action"), run: () => void openConnect() },
    });
  } else if (mod?.installed.includes(OWN_MOD) && mod.ownOutdated) {
    list.push({
      id: "mod-outdated",
      tone: "info",
      icon: PlugZap,
      title: t("notice.mod.title"),
      body: t("notice.mod.body"),
      action: { label: t("notice.mod.action"), run: () => void installMod().catch(() => {}) },
      dismiss: "forever",
    });
  }

  if (relay?.enabled && relay.state === "needsSignIn") {
    list.push({
      id: "relay-signin",
      tone: "warning",
      icon: CloudOff,
      title: t("notice.relay.signIn.title"),
      body: t("notice.relay.signIn.body"),
      action: { label: t("notice.relay.signIn.action"), run: openAccount },
      dismiss: "forever",
    });
  } else if (relay?.enabled && relay.state === "error") {
    list.push({
      id: `relay-error:${relay.message ?? ""}`,
      tone: "danger",
      icon: CloudOff,
      title: t("notice.relay.error.title"),
      body: relay.message ?? undefined,
      action: { label: t("notice.open.settings"), run: () => void openConnect() },
      dismiss: "forever",
    });
  }

  if (ghExpired) {
    list.push({
      id: "github-expired",
      tone: "warning",
      icon: TriangleAlert,
      title: t("notice.github.title"),
      body: ghLogin ? (
        <span className="space-y-1">
          <span className="block">{t("account.githubWaiting")}</span>
          <span className="selectable block font-mono text-sm font-semibold tracking-[0.2em] text-text">
            {ghLogin.userCode}
          </span>
        </span>
      ) : (
        (ghLoginError ?? t("notice.github.body"))
      ),
      action: ghLogin
        ? {
            label: t("account.copyAndOpen"),
            run: () => {
              void navigator.clipboard.writeText(ghLogin.userCode).catch(() => {});
              open(ghLogin.verificationUri);
            },
          }
        : {
            label: t("notice.github.action"),
            run: () => void useGitHubStore.getState().startLogin(),
          },
      dismiss: "close",
      onClose: () => {
        if (ghLogin) useGitHubStore.getState().cancelLogin();
        useGitHubStore.setState({ expired: false });
      },
    });
  }

  if (
    update.version &&
    (update.status === "available" || update.status === "downloading") &&
    update.dismissed !== update.version
  ) {
    const downloading = update.status === "downloading";
    list.push({
      id: `update:${update.version}`,
      tone: "info",
      icon: Download,
      title: t("update.available", { version: update.version }),
      body: downloading ? t("update.downloading") : undefined,
      action: downloading
        ? undefined
        : { label: t("update.install"), run: () => void update.install() },
      // Not again for this version (the updater remembers it).
      dismiss: downloading ? undefined : "forever",
      onClose: update.dismiss,
    });
  }

  if (syncNotice) {
    list.push({
      id: "sync",
      tone: "warning",
      icon: TriangleAlert,
      title: t("sync.notice.title"),
      body: (
        <ul className="max-h-32 space-y-0.5 overflow-y-auto">
          {syncNotice.conflicts.map((c) => (
            <li key={`${c.kind}:${c.name}:${c.copy ?? ""}`}>
              {c.copy
                ? t("sync.notice.copy", { name: c.name, copy: c.copy })
                : t("sync.notice.revived", { name: c.name })}
            </li>
          ))}
          {syncNotice.held.length > 0 && (
            <li>{t("sync.notice.held", { names: syncNotice.held.join(", ") })}</li>
          )}
          {syncNotice.failed.map(([name, why]) => (
            <li key={`f:${name}:${why}`}>{t("sync.notice.failed", { name, why })}</li>
          ))}
          {syncNotice.kept.length > 0 && (
            <li>{t("sync.notice.kept", { names: syncNotice.kept.join(", ") })}</li>
          )}
        </ul>
      ),
      dismiss: "close",
      onClose: dismissSync,
    });
  }

  const shown = list.filter((n) => n.dismiss !== "forever" || !dismissed.includes(n.id));
  const order = (n: Notice) => {
    if (!firstSeen.has(n.id)) firstSeen.set(n.id, Date.now() + firstSeen.size / 1000);
    return firstSeen.get(n.id) ?? 0;
  };
  return shown.sort((a, b) => order(a) - order(b));
}

/** "Don't show again" (remembered) or the notice's own close. */
export function dismissNotice(n: Notice, remember: (id: string) => void) {
  if (n.onClose) n.onClose();
  else if (n.dismiss === "forever") remember(n.id);
}

export const TONE: Record<Tone, string> = {
  info: "text-accent",
  warning: "text-warning",
  danger: "text-danger",
};

/**
 * The notices, in the main menu above the account: each new one stacks on
 * top of the ones before it.
 */
export function NoticeStack({ collapsed }: { collapsed: boolean }) {
  const t = useT();
  const notices = useNotices();
  const dismiss = useNoticesStore((s) => s.dismiss);
  const expand = useWorkspaceStore((s) => s.toggleCollapsed);

  // What the notices are made from: loaded once the window opens.
  useEffect(() => {
    void useConnectionStore.getState().load();
  }, []);

  if (notices.length === 0) return null;

  if (collapsed) {
    const worst = notices.some((n) => n.tone === "danger")
      ? "danger"
      : notices.some((n) => n.tone === "warning")
        ? "warning"
        : "info";
    return (
      <button
        type="button"
        onClick={expand}
        title={t("notice.count", { n: notices.length })}
        aria-label={t("notice.count", { n: notices.length })}
        className="relative mx-auto mb-1 flex size-8 items-center justify-center rounded-md hover:bg-hover"
      >
        <Bell size={16} className={TONE[worst]} />
        <span className="absolute top-0.5 right-0.5 min-w-3.5 rounded-full bg-sunken px-0.5 text-center text-fs-10 font-semibold leading-3.5">
          {notices.length}
        </span>
      </button>
    );
  }

  return (
    <section
      aria-label={t("notice.region")}
      className="flex max-h-[45vh] flex-col justify-end gap-1.5 overflow-y-auto px-2 pb-1"
    >
      {notices.map((n) => (
        <NoticeCard key={n.id} notice={n} onDismiss={() => dismissNotice(n, dismiss)} />
      ))}
    </section>
  );
}

export function NoticeCard({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const t = useT();
  const Icon = notice.icon;
  const dismissLabel: MessageKey =
    notice.dismiss === "forever" ? "notice.dismiss.forever" : "notice.dismiss.close";
  return (
    <div
      role={notice.tone === "info" ? "status" : "alert"}
      className="rounded-lg bg-surface-raised px-2.5 py-2 text-fs-12 shadow-card"
    >
      <div className="flex items-start gap-2">
        <Icon size={14} className={`mt-0.5 shrink-0 ${TONE[notice.tone]}`} />
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug">{notice.title}</p>
          {notice.body && (
            <div className="selectable mt-0.5 text-fs-11 break-words text-text-muted">
              {notice.body}
            </div>
          )}
        </div>
      </div>
      {(notice.action || notice.dismiss) && (
        <div className="mt-1.5 flex items-center justify-end gap-1">
          {notice.dismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded px-1.5 py-0.5 text-fs-11 text-text-subtle hover:bg-hover hover:text-text"
            >
              {t(dismissLabel)}
            </button>
          )}
          {notice.action && (
            <Button size="sm" variant="primary" onClick={notice.action.run}>
              {notice.action.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
