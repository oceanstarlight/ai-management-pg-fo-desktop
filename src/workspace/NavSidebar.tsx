import {
  Activity,
  AlarmClock,
  CircleUserRound,
  FolderGit2,
  type LucideIcon,
  NotebookPen,
  PanelLeft,
  PanelRightOpen,
  Settings,
  Wrench,
} from "lucide-react";
import { Logo } from "../components/Logo";
import { IconButton } from "../components/ui";
import { NoticeStack } from "../features/notices/NoticeStack";
import { UpdateIndicator } from "../features/update/UpdateIndicator";
import { type MessageKey, useT } from "../i18n";
import { useAccountStore } from "../store/account";
import { type Page, useWorkspaceStore } from "../store/workspace";
import { switchToSidebar } from "./leave";

type NavItem = { page: Page; label: MessageKey; icon: LucideIcon };

/** What Claude is doing comes first; the rest supports it. */
const NAV: NavItem[] = [
  { page: "home", label: "shell.nav.live", icon: Activity },
  { page: "project", label: "shell.nav.project", icon: FolderGit2 },
  { page: "tools", label: "shell.nav.toolbox", icon: Wrench },
  { page: "automations", label: "shell.nav.automations", icon: AlarmClock },
  { page: "memo", label: "shell.nav.memo", icon: NotebookPen },
];

export function NavSidebar() {
  const { page, collapsed, go, toggleCollapsed } = useWorkspaceStore();
  const t = useT();
  const account = useAccountStore((s) => s.info);
  const openAccount = useAccountStore((s) => s.openDialog);
  const accountLabel = account?.uid
    ? (account.profile?.email ?? account.profile?.name ?? t("account.title"))
    : t("account.nav.signIn");

  return (
    <aside
      className="flex shrink-0 flex-col bg-sidebar transition-[width] duration-200"
      style={{ width: collapsed ? 52 : 216 }}
    >
      <div className="flex h-12 shrink-0 items-center gap-1 px-2.5">
        {!collapsed && (
          <button
            type="button"
            onClick={() => go("home")}
            className="flex min-w-0 items-center gap-2 rounded-md px-1.5 text-sm font-semibold tracking-tight"
          >
            <Logo size={18} />
            <span className="truncate">Encela</span>
          </button>
        )}
        <IconButton
          label={collapsed ? t("shell.nav.expand") : t("shell.nav.collapse")}
          onClick={toggleCollapsed}
          className={collapsed ? "" : "ml-auto"}
        >
          <PanelLeft size={16} />
        </IconButton>
      </div>

      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2">
        {NAV.map((item) => (
          <NavButton
            key={item.page}
            icon={item.icon}
            label={t(item.label)}
            collapsed={collapsed}
            active={page === item.page}
            onClick={() => go(item.page)}
          />
        ))}
      </nav>

      <NoticeStack collapsed={collapsed} />

      <div className="space-y-0.5 p-2">
        <UpdateIndicator variant="nav" collapsed={collapsed} />
        {account?.configured && (
          <NavButton
            icon={CircleUserRound}
            label={accountLabel}
            collapsed={collapsed}
            onClick={openAccount}
          />
        )}
        <NavButton
          icon={PanelRightOpen}
          label={t("shell.switchToSidebar")}
          collapsed={collapsed}
          onClick={() => void switchToSidebar()}
        />
        <NavButton
          icon={Settings}
          label={t("shell.nav.settings")}
          collapsed={collapsed}
          active={page === "settings"}
          onClick={() => go("settings")}
        />
      </div>
    </aside>
  );
}

interface NavButtonProps {
  icon: LucideIcon;
  label: string;
  collapsed: boolean;
  active?: boolean;
  onClick: () => void;
}

function NavButton({ icon: Icon, label, collapsed, active, onClick }: NavButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-sm transition-colors ${
        active ? "bg-active text-text" : "text-text-muted hover:bg-hover hover:text-text"
      }`}
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        <Icon size={16} strokeWidth={active ? 2.2 : 1.8} />
      </span>
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
}
