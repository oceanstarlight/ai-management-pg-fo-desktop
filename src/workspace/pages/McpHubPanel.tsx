import { ask } from "@tauri-apps/plugin-dialog";
import {
  ClipboardPaste,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, IconButton, PageHeader, Switch } from "../../components/ui";
import { type MessageKey, useT } from "../../i18n";
import { type HubEntry, hubCanRun, useHubStore } from "../../store/hub";
import {
  emptyConfig,
  looksSecret,
  type McpConfig,
  type McpScope,
  type McpServer,
  type Transport,
  useMcpStore,
} from "../../store/mcp";
import { useProjectStore } from "../../store/project";
import { ConfigFields, Dialog, Field, ImportDialog, input } from "./McpPage";

type ApplyScope = Exclude<McpScope, "other">;
const APPLY_SCOPES: ApplyScope[] = ["local", "project", "user"];
const TRANSPORTS: Transport[] = ["stdio", "http", "sse", "ws"];

interface EntryDraft {
  original: string | null;
  entry: HubEntry;
}

const newEntry = (p?: Partial<HubEntry>): HubEntry => ({
  name: "",
  description: "",
  tags: [],
  config: emptyConfig(),
  inHub: true,
  tools: [],
  checkedAt: null,
  ...p,
});

/** MCP servers kept without installing them: put into projects, or offered through encela-hub. */
export function McpHubPanel() {
  const t = useT();
  const project = useProjectStore((s) => s.current);
  const tool = useProjectStore((s) => s.tool);
  const { entries, loaded, error, load, loadServer, dismissError } = useHubStore();
  const mcp = useMcpStore();
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [importing, setImporting] = useState(false);
  const [applying, setApplying] = useState<HubEntry | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void load();
    void loadServer();
  }, [load, loadServer]);

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
      [e.name, e.description, ...e.tags, ...e.tools.map((x) => x.name)].some((s) =>
        s.toLowerCase().includes(q),
      ),
    );
  }, [entries, query]);

  return (
    <div>
      <PageHeader
        embedded
        title={t("hub.title")}
        description={t("hub.description")}
        actions={
          <>
            <Button size="sm" onClick={() => setImporting(true)}>
              <ClipboardPaste size={13} />
              {t("hub.import")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => setDraft({ original: null, entry: newEntry() })}
            >
              <Plus size={13} />
              {t("hub.add")}
            </Button>
          </>
        }
      />

      <Gateway count={entries.filter((e) => e.inHub && hubCanRun(e.config)).length} />

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          <p className="selectable min-w-0 flex-1 whitespace-pre-wrap break-words">{error}</p>
          <button type="button" aria-label={t("work.close")} onClick={dismissError}>
            <X size={13} />
          </button>
        </div>
      )}
      {!project && <p className="mb-3 text-xs text-text-muted">{t("hub.noProject")}</p>}
      {project && tool !== "claude" && (
        <p className="mb-3 text-xs text-text-muted">{t("hub.codexNote")}</p>
      )}

      {entries.length > 4 && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("hub.search")}
          spellCheck={false}
          className={`${input} mb-3`}
        />
      )}

      {loaded && entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-text-subtle">
          {t("hub.empty")}
        </p>
      ) : shown.length === 0 && entries.length > 0 ? (
        <p className="text-xs text-text-subtle">{t("hub.noMatch")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg bg-surface-raised">
          {shown.map((e) => (
            <EntryRow
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

      <p className="mt-6 flex items-start gap-1.5 text-fs-11 leading-snug text-text-subtle">
        <ShieldAlert size={12} className="mt-0.5 shrink-0" />
        {t("hub.security")}
      </p>

      {draft && <EntryDialog draft={draft} onClose={() => setDraft(null)} />}
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onPick={(p) => {
            setImporting(false);
            setDraft({ original: null, entry: newEntry({ name: p.name, config: p.config }) });
          }}
        />
      )}
      {applying && project && (
        <ApplyDialog entry={applying} project={project} onClose={() => setApplying(null)} />
      )}
    </div>
  );
}

/** encela-hub in Claude Code: connected or not. */
function Gateway({ count }: { count: number }) {
  const t = useT();
  const { server, connectServer, disconnectServer } = useHubStore();
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    await f();
    setBusy(false);
  };
  const state = !server
    ? null
    : !server.claudeFound
      ? "noClaude"
      : server.registered && server.current
        ? "connected"
        : server.registered
          ? "stale"
          : "off";
  return (
    <section className="mb-6">
      <div className="flex items-center gap-2">
        <h3 className="text-fs-11 font-medium tracking-wide text-text-subtle">
          {t("hub.gateway.title")} <span className="font-mono font-normal">encela-hub</span>
        </h3>
        <span className="text-fs-11 text-text-subtle">· {t("hub.gateway.count", { count })}</span>
      </div>
      <p className="mt-0.5 mb-2 text-fs-11 leading-snug text-text-muted">{t("hub.gateway.hint")}</p>
      {state && (
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`size-2 shrink-0 rounded-full ${
              state === "connected"
                ? "bg-success"
                : state === "stale"
                  ? "bg-warning"
                  : "bg-border-strong"
            }`}
          />
          <span className="text-text-muted">{t(`hub.gateway.${state}` as MessageKey)}</span>
          {state !== "noClaude" && (
            <span className="ml-auto flex gap-1.5">
              {state !== "connected" && (
                <Button size="sm" disabled={busy} onClick={() => void run(connectServer)}>
                  {t(state === "stale" ? "hub.gateway.reconnect" : "hub.gateway.connect")}
                </Button>
              )}
              {state !== "off" && (
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

function EntryRow({
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
  const runnable = hubCanRun(e.config);
  const target =
    e.config.transport === "stdio" ? [e.config.command, ...e.config.args].join(" ") : e.config.url;

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
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-medium">{e.name}</span>
            <span className="rounded bg-sunken px-1.5 text-fs-10 text-text-subtle">
              {e.config.transport}
            </span>
            {e.tags.map((tag) => (
              <span key={tag} className="text-fs-10 text-text-subtle">
                #{tag}
              </span>
            ))}
          </div>
          {e.description && (
            <p className="mt-0.5 text-fs-11 leading-snug text-text-muted">{e.description}</p>
          )}
          <div className="selectable truncate font-mono text-fs-11 text-text-subtle" title={target}>
            {target}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-fs-11 text-text-subtle">
            <span title={e.tools.map((x) => x.name).join(", ")}>
              {e.checkedAt ? t("hub.tools", { count: e.tools.length }) : t("hub.toolsUnknown")}
            </span>
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

function EntryDialog({ draft, onClose }: { draft: EntryDraft; onClose: () => void }) {
  const t = useT();
  const save = useHubStore((s) => s.save);
  const [name, setName] = useState(draft.entry.name);
  const [description, setDescription] = useState(draft.entry.description);
  const [tags, setTags] = useState(draft.entry.tags.join(", "));
  const [config, setConfig] = useState<McpConfig>(draft.entry.config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const secrets = [...Object.entries(config.env), ...Object.entries(config.headers)].some(
    ([k, v]) => looksSecret(k, v),
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await save(draft.original, {
        ...draft.entry,
        name: name.trim(),
        description,
        tags: tags.split(/[,，]/).map((s) => s.trim()),
        config,
      });
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
          <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void submit()}>
            {busy ? t("mcp.form.saving") : t("mcp.form.save")}
          </Button>
        </>
      }
    >
      <Field label={t("mcp.form.name")} hint={t("mcp.form.nameHint")}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          spellCheck={false}
          className={`${input} font-mono`}
        />
      </Field>
      <Field label={t("hub.form.description")} hint={t("hub.form.descriptionHint")}>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className={`${input} resize-y`}
        />
      </Field>
      <Field label={t("hub.form.tags")} hint={t("hub.form.tagsHint")}>
        <input value={tags} onChange={(e) => setTags(e.target.value)} className={input} />
      </Field>
      <ConfigFields
        transports={TRANSPORTS}
        name={name}
        shared
        config={config}
        onChange={setConfig}
      />
      {!hubCanRun(config) && <p className="text-fs-11 text-text-muted">{t("hub.form.runOff")}</p>}
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
