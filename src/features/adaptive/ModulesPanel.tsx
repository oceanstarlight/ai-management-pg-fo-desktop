import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Download,
  ExternalLink,
  GitBranch,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, IconButton, Switch } from "../../components/ui";
import { type MessageKey, useT } from "../../i18n";
import { emptyModule, type HubEntry, hubCanRun, useHubStore } from "../../store/hub";
import { looksSecret, type McpScope, type McpServer, useMcpStore } from "../../store/mcp";
import { useProjectStore } from "../../store/project";
import { Dialog, Field, ImportDialog, input } from "../../workspace/pages/McpPage";
import { GithubDialog } from "./GithubDialog";
import { ModuleForm } from "./ModuleForm";

type ApplyScope = Exclude<McpScope, "other">;
const APPLY_SCOPES: ApplyScope[] = ["local", "project", "user"];

interface Draft {
  original: string | null;
  entry: HubEntry;
}

/** The kept modules: add (by hand, pasted, from GitHub), check, put into projects, edit. */
export function ModulesPanel() {
  const t = useT();
  const project = useProjectStore((s) => s.current);
  const tool = useProjectStore((s) => s.tool);
  const entries = useHubStore((s) => s.entries);
  const loaded = useHubStore((s) => s.loaded);
  const mcp = useMcpStore();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [importing, setImporting] = useState(false);
  const [fromGithub, setFromGithub] = useState(false);
  const [applying, setApplying] = useState<HubEntry | null>(null);
  const [query, setQuery] = useState("");

  // What this project already has, to show what's in and to take it out.
  useEffect(() => {
    if (project && tool === "claude" && (mcp.project !== project || mcp.tool !== "claude")) {
      void mcp.load(project, "claude");
    }
  }, [project, tool, mcp.project, mcp.tool, mcp.load]);
  const installed = project && mcp.project === project && mcp.tool === "claude" ? mcp.servers : [];

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      [e.name, e.description, ...e.tags, ...e.capabilities, ...e.tools.map((x) => x.name)].some(
        (s) => s.toLowerCase().includes(q),
      ),
    );
  }, [entries, query]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {entries.length > 4 ? (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("hub.search")}
            spellCheck={false}
            className={`${input} max-w-xs`}
          />
        ) : (
          <span className="text-xs text-text-muted">
            {t("adaptive.modules.count", { count: entries.length })}
          </span>
        )}
        <span className="ml-auto flex gap-1.5">
          <Button size="sm" onClick={() => setImporting(true)}>
            <ClipboardPaste size={13} />
            {t("hub.import")}
          </Button>
          <Button size="sm" onClick={() => setDraft({ original: null, entry: emptyModule() })}>
            <Plus size={13} />
            {t("adaptive.modules.addManual")}
          </Button>
          <Button size="sm" variant="primary" onClick={() => setFromGithub(true)}>
            <GitBranch size={13} />
            {t("adaptive.github.add")}
          </Button>
        </span>
      </div>
      {!project && <p className="mb-3 text-xs text-text-muted">{t("hub.noProject")}</p>}
      {project && tool !== "claude" && (
        <p className="mb-3 text-xs text-text-muted">{t("hub.codexNote")}</p>
      )}

      {loaded && entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-text-subtle">
          {t("adaptive.modules.empty")}
        </p>
      ) : shown.length === 0 && entries.length > 0 ? (
        <p className="text-xs text-text-subtle">{t("hub.noMatch")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg bg-surface-raised">
          {shown.map((e) => (
            <ModuleRow
              key={e.name}
              entry={e}
              project={project}
              installed={installed.filter((s) => s.name === e.name && s.scope !== "other")}
              onEdit={() => setDraft({ original: e.name, entry: e })}
              onApply={() => setApplying(e)}
            />
          ))}
        </ul>
      )}

      {draft && <ModuleDialog draft={draft} onClose={() => setDraft(null)} />}
      {fromGithub && <GithubDialog onClose={() => setFromGithub(false)} />}
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onPick={(p) => {
            setImporting(false);
            setDraft({ original: null, entry: emptyModule({ name: p.name, config: p.config }) });
          }}
        />
      )}
      {applying && project && (
        <ApplyDialog entry={applying} project={project} onClose={() => setApplying(null)} />
      )}
    </div>
  );
}

/** The kind of a module, as a small badge. */
export function KindBadge({ entry }: { entry: Pick<HubEntry, "kind" | "config"> }) {
  const t = useT();
  return (
    <span className="rounded bg-sunken px-1.5 text-fs-10 text-text-subtle">
      {t(`adaptive.kind.${entry.kind}` as MessageKey)}
      {entry.kind === "mcp" && ` · ${entry.config.transport}`}
    </span>
  );
}

function ModuleRow({
  entry: e,
  project,
  installed,
  onEdit,
  onApply,
}: {
  entry: HubEntry;
  project: string | null;
  installed: McpServer[];
  onEdit: () => void;
  onApply: () => void;
}) {
  const t = useT();
  const { remove, setInHub, check } = useHubStore.getState();
  const checking = useHubStore((s) => s.checking.includes(e.name));
  const checkError = useHubStore((s) => s.checkErrors[e.name]);
  const [open, setOpen] = useState(false);
  const runnable = hubCanRun(e);
  const mcp = e.kind === "mcp";
  const target = !mcp
    ? e.install[0] || ""
    : e.config.transport === "stdio"
      ? [e.config.command, ...e.config.args].join(" ")
      : e.config.url;

  const takeOut = async (s: McpServer) => {
    if (!project) return;
    const scope = t(`mcp.scopeShort.${s.scope}` as MessageKey);
    const ok = await ask(t("hub.takeOutConfirm", { name: s.name, scope }), {
      title: t("hub.takeOut"),
      kind: "warning",
    }).catch(() => false);
    if (ok) await useMcpStore.getState().remove(project, s);
  };

  return (
    <li className="px-3.5 py-2.5">
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label={open ? t("adaptive.collapse") : t("adaptive.expand")}
          onClick={() => setOpen(!open)}
          className="mt-0.5 rounded p-0.5 text-text-subtle hover:bg-hover hover:text-text"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-medium">{e.name}</span>
            <KindBadge entry={e} />
            {e.tags.map((tag) => (
              <span key={tag} className="text-fs-10 text-text-subtle">
                #{tag}
              </span>
            ))}
            {e.warnings.length > 0 && (
              <span title={e.warnings.join("\n")} className="text-warning">
                <AlertTriangle size={12} />
              </span>
            )}
          </div>
          {e.description && (
            <p className="mt-0.5 text-fs-11 leading-snug text-text-muted">{e.description}</p>
          )}
          {target && (
            <div
              className="selectable truncate font-mono text-fs-11 text-text-subtle"
              title={target}
            >
              {target}
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-fs-11 text-text-subtle">
            {mcp && (
              <span title={e.tools.map((x) => x.name).join(", ")}>
                {e.checkedAt ? t("hub.tools", { count: e.tools.length }) : t("hub.toolsUnknown")}
              </span>
            )}
            {e.installedDir && <span>{t("adaptive.built")}</span>}
            {installed.map((s) => (
              <span key={s.scope} className="flex items-center gap-1 text-text-muted">
                {t("hub.installed", { scope: t(`mcp.scopeShort.${s.scope}` as MessageKey) })}
                <button
                  type="button"
                  title={t("hub.takeOut")}
                  aria-label={t("hub.takeOut")}
                  onClick={() => void takeOut(s)}
                  className="rounded p-0.5 hover:bg-hover hover:text-text"
                >
                  <Undo2 size={11} />
                </button>
              </span>
            ))}
          </div>
          {!runnable && <p className="mt-0.5 text-fs-11 text-text-muted">{t("hub.inHubOff")}</p>}
          {checkError && (
            <p className="selectable mt-1 text-fs-11 whitespace-pre-wrap break-words text-danger">
              {checkError}
            </p>
          )}
          {open && <ModuleDetails entry={e} />}
        </div>
        <span className="flex shrink-0 items-center gap-1.5" title={t("hub.inHub")}>
          <span className="text-fs-11 text-text-subtle">{t("hub.inHub")}</span>
          <Switch
            checked={e.inHub && runnable}
            disabled={!runnable}
            label={t("hub.inHub")}
            onChange={(on) => void setInHub(e, on)}
          />
        </span>
        {mcp && (
          <>
            <IconButton
              label={checking ? t("hub.checking") : t("hub.check")}
              disabled={checking || !runnable}
              onClick={() => void check(e.name, project)}
            >
              <RefreshCw size={14} className={checking ? "animate-spin" : ""} />
            </IconButton>
            <IconButton label={t("hub.apply")} disabled={!project} onClick={onApply}>
              <Download size={14} />
            </IconButton>
          </>
        )}
        <IconButton label={t("hub.edit")} onClick={onEdit}>
          <Pencil size={14} />
        </IconButton>
        <IconButton
          label={t("hub.delete")}
          onClick={async () => {
            const ok = await ask(t("hub.deleteConfirm", { name: e.name }), {
              title: t("hub.deleteTitle"),
              kind: "warning",
            }).catch(() => false);
            if (ok) await remove(e.name);
          }}
        >
          <Trash2 size={14} />
        </IconButton>
      </div>
    </li>
  );
}

/** What the analysis found: how it talks, what it takes and gives, warnings, guide. */
export function ModuleDetails({ entry: e }: { entry: HubEntry }) {
  const t = useT();
  const rows: [MessageKey, string][] = [
    ["adaptive.form.capabilities", e.capabilities.join(", ")],
    ["adaptive.form.inputs", e.inputs.join(", ")],
    ["adaptive.form.outputs", e.outputs.join(", ")],
    ["adaptive.install", e.install.join("\n")],
    ["adaptive.builtAt", e.installedDir ?? ""],
  ];
  return (
    <div className="mt-2 space-y-2 border-l-2 border-border pl-3 text-fs-11">
      {e.source && (
        <div className="flex flex-wrap items-center gap-2 text-text-muted">
          <button
            type="button"
            onClick={() =>
              void openUrl(
                `https://github.com/${e.source?.repo}${e.source?.commit ? `/tree/${e.source.commit}` : ""}`,
              )
            }
            className="flex items-center gap-0.5 hover:text-text"
          >
            {e.source.repo}
            {e.source.commit && ` @ ${e.source.commit.slice(0, 7)}`}
            <ExternalLink size={10} />
          </button>
          <span className={e.source.licenseOk ? "text-text-subtle" : "text-warning"}>
            {e.source.license ?? t("adaptive.licenseUnknown")}
          </span>
        </div>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-text-subtle">{t(k)}</dt>
              <dd className="selectable whitespace-pre-wrap break-words font-mono text-text-muted">
                {v}
              </dd>
            </div>
          ))}
      </dl>
      {e.warnings.map((w) => (
        <p key={w} className="flex gap-1 text-warning">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          {w}
        </p>
      ))}
      {e.guide && (
        <pre className="selectable max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-sunken p-2 font-mono text-fs-11 text-text-muted">
          {e.guide}
        </pre>
      )}
    </div>
  );
}

function ModuleDialog({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const t = useT();
  const save = useHubStore((s) => s.save);
  const [entry, setEntry] = useState<HubEntry>(draft.entry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const secrets = [
    ...Object.entries(entry.config.env),
    ...Object.entries(entry.config.headers),
  ].some(([k, v]) => looksSecret(k, v));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await save(draft.original, { ...entry, name: entry.name.trim() });
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={draft.original ? t("hub.form.titleEdit") : t("hub.form.titleNew")}
      onClose={onClose}
      footer={
        <>
          {error && (
            <p className="selectable mr-auto min-w-0 flex-1 text-xs whitespace-pre-wrap text-danger">
              {error}
            </p>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t("mcp.form.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !entry.name.trim()}
            onClick={() => void submit()}
          >
            {busy ? t("mcp.form.saving") : t("mcp.form.save")}
          </Button>
        </>
      }
    >
      <ModuleForm value={entry} onChange={setEntry} />
      {!hubCanRun(entry) && <p className="text-fs-11 text-text-muted">{t("hub.form.runOff")}</p>}
      {secrets && <p className="text-fs-11 text-warning">{t("hub.form.secret")}</p>}
    </Dialog>
  );
}

function ApplyDialog({
  entry,
  project,
  onClose,
}: {
  entry: HubEntry;
  project: string;
  onClose: () => void;
}) {
  const t = useT();
  const apply = useHubStore((s) => s.apply);
  const [scope, setScope] = useState<ApplyScope>("local");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const secrets = [
    ...Object.entries(entry.config.env),
    ...Object.entries(entry.config.headers),
  ].some(([k, v]) => looksSecret(k, v));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apply(project, entry.name, scope);
      await useMcpStore.getState().load(project, "claude");
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("hub.applyTitle", { name: entry.name })}
      onClose={onClose}
      footer={
        <>
          {error && (
            <p className="selectable mr-auto min-w-0 flex-1 text-xs whitespace-pre-wrap text-danger">
              {error}
            </p>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t("mcp.form.cancel")}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? t("hub.applying") : t("hub.applyDo")}
          </Button>
        </>
      }
    >
      <p className="selectable text-xs break-all text-text-muted">
        {t("hub.applyHint", { project })}
      </p>
      <Field label={t("mcp.form.scope")} hint={t(`mcp.scopeHint.${scope}` as MessageKey)}>
        <div className="flex gap-1 rounded-lg bg-sunken p-0.5 text-xs">
          {APPLY_SCOPES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={scope === s}
              onClick={() => setScope(s)}
              className={`flex-1 rounded-md px-2 py-1 font-medium ${
                scope === s ? "bg-surface-raised text-text shadow-card" : "text-text-muted"
              }`}
            >
              {t(`mcp.scopeShort.${s}` as MessageKey)}
            </button>
          ))}
        </div>
      </Field>
      {secrets && scope === "project" && (
        <p className="rounded-md bg-warning/10 px-2 py-1.5 text-fs-11 text-warning">
          {t("mcp.form.secretProject")}
        </p>
      )}
    </Dialog>
  );
}
