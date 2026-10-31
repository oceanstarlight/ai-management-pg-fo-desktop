import {
  Activity,
  AlarmClock,
  ChevronsUpDown,
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
import { UpdateIndicator } from "../features/update/UpdateIndicator";
import { type MessageKey, useT } from "../i18n";
import { useAccountStore } from "../store/account";
import { useProjectStore } from "../store/project";
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

const CHOOSE = "\u0000choose";
const folder = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** The open project, switchable from the top of the menu. */
function ProjectPicker({ collapsed }: { collapsed: boolean }) {
  const t = useT();
  const project = useProjectStore((s) => s.current);
  const recent = useProjectStore((s) => s.recent);
  const projects = project && !recent.includes(project) ? [project, ...recent] : recent;
  if (collapsed) return null;
  return (
    <label className="relative mx-2 mb-3 flex items-center rounded-md px-2 py-1.5 text-sm hover:bg-hover">
      <span className="min-w-0 flex-1">
        <span className="block text-fs-11 text-text-subtle">{t("shell.project")}</span>
        <span className="block truncate font-medium" title={project ?? undefined}>
          {project ? folder(project) : t("docs.project.none")}
        </span>
      </span>
      <ChevronsUpDown size={14} className="shrink-0 text-text-subtle" />
      <select
        aria-label={t("docs.project.recent")}
        value={project ?? ""}
        onChange={(e) => {
          const { select, choose } = useProjectStore.getState();
          if (e.target.value === CHOOSE) void choose();
          else if (e.target.value) void select(e.target.value);
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {!project && <option value="">{t("docs.project.none")}</option>}
        {projects.map((path) => (
          <option key={path} value={path}>
            {folder(path)}
          </option>
        ))}
        <option value={CHOOSE}>{t("docs.project.choose")}</option>
      </select>
    </label>
  );
}

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

      <ProjectPicker collapsed={collapsed} />

      <nav className="flex-1 space-y-0.5 px-2">
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
