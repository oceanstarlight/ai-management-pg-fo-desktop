import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Check, Copy, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Switch } from "../../components/ui";
import { type MessageKey, timeAgo, useLocale, useT } from "../../i18n";
import { setPref } from "../../store/prefs";
import { open } from "../work/useGitHubSync";

// Mirrors `Block` in src-tauri/src/catalog/blocks.rs (the fields shown here).
type Kind = "instruction" | "rule" | "skill" | "agent" | "hook";

interface Block {
  id: string;
  kind: Kind;
  title: string;
  summary: string;
  category: string;
  detail?: string;
  en?: { title: string; summary: string; category: string; detail?: string };
  body: string;
  origin: { repo: string; commit: string; path: string; license: string } | null;
  /** Taken in from "새로 발견" rather than bundled. */
  found: boolean;
}

// Mirrors `CheckResult` and `Discovered` in src-tauri/src/catalog/mod.rs.
interface CheckResult {
  refresh: { updated: string[]; unchanged: number; failed: [string, string][] };
  discover: { added: number; waiting: number; failed: [string, string][] };
}

interface Candidate {
  id: string;
  kind: Kind;
  name: string;
  description: string;
  repo: string;
  commit: string;
  path: string;
  license: string;
  category: string;
  categoryEn: string;
  warnings: string[];
  size: number;
}

interface Discovered {
  checkedAt: number;
  candidates: Candidate[];
  failed: [string, string][];
  auto: boolean;
}

/** Same key as `catalog::AUTO_PREF`. */
const AUTO_PREF = "catalogAutoCheck";

const KINDS: Kind[] = ["instruction", "rule", "skill", "agent", "hook"];

/**
 * Ready-made blocks (instructions, rules, skills, subagents, hooks): find one,
 * read it, copy it into the project's CLAUDE.md or `.claude` files. Claude Code
 * can search the same list through the app's MCP server.
 */
export function CatalogPanel() {
  const t = useT();
  const locale = useLocale();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [kind, setKind] = useState<Kind | "all">("all");
  const [query, setQuery] = useState("");
  const [open_, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const [found, setFound] = useState<Discovered | null>(null);

  const load = useCallback(async () => {
    if (!isTauri()) return;
    const [list, discovered] = await Promise.all([
      invoke<Block[]>("catalog_list").catch(() => []),
      invoke<Discovered>("catalog_discovered").catch(() => null),
    ]);
    setBlocks(list);
    setFound(discovered);
  }, []);
  useEffect(() => {
    void load();
    if (!isTauri()) return;
    // The daily check ran in the background.
    const off = listen("catalog-changed", () => void load());
    return () => void off.then((f) => f());
  }, [load]);

  const check = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await invoke<CheckResult>("catalog_refresh");
      setNote(
        t("catalog.refreshed", {
          updated: r.refresh.updated.length,
          added: r.discover.added,
          failed: r.refresh.failed.length + r.discover.failed.length,
        }),
      );
      await load();
    } catch (e) {
      setNote(String(e));
    }
    setBusy(false);
  };

  const act = async (command: string, id: string) => {
    setBusy(true);
    try {
      await invoke(command, { id });
      await load();
    } catch (e) {
      setNote(String(e));
    }
    setBusy(false);
  };

  const text = (b: Block) => (locale === "en" && b.en ? b.en : b);
  const list = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return blocks.filter((b) => {
      if (kind !== "all" && b.kind !== kind) return false;
      const hay =
        `${b.title} ${b.summary} ${b.category} ${b.en?.title ?? ""} ${b.en?.summary ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [blocks, kind, query]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("catalog.search")}
          className="w-64 rounded-md bg-surface-raised px-3 py-1.5 text-sm ring-1 ring-transparent outline-none placeholder:text-text-subtle focus:ring-border-strong"
        />
        <div className="flex gap-1">
          {(["all", ...KINDS] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`rounded-md px-2 py-1 text-xs ${
                kind === k
                  ? "bg-active text-text"
                  : "text-text-muted hover:bg-hover hover:text-text"
              }`}
            >
              {t(`catalog.kind.${k}` as MessageKey)}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          disabled={busy}
          onClick={() => void check()}
        >
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
          {t("catalog.refresh")}
        </Button>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-text-muted">
        <Switch
          checked={found?.auto ?? true}
          label={t("catalog.auto")}
          onChange={(on) => {
            setPref(AUTO_PREF, on ? null : "off");
            setFound((f) => (f ? { ...f, auto: on } : f));
          }}
        />
        <span>{t("catalog.auto")}</span>
        <span className="text-text-subtle">
          ·{" "}
          {found?.checkedAt
            ? t("catalog.checkedAt", { when: timeAgo(found.checkedAt / 1000) })
            : t("catalog.neverChecked")}
        </span>
      </div>
      {note && <p className="mb-4 text-xs text-text-muted">{note}</p>}
      {found && found.candidates.length > 0 && (
        <FoundList
          items={found.candidates.filter((c) => kind === "all" || c.kind === kind)}
          busy={busy}
          onAccept={(id) => act("catalog_accept", id)}
          onDismiss={(id) => act("catalog_dismiss", id)}
        />
      )}
      <ul className="space-y-1">
        {list.map((b) => {
          const x = text(b);
          const expanded = open_ === b.id;
          return (
            <li key={b.id}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : b.id)}
                className="flex w-full items-baseline gap-3 rounded-md px-2 py-2 text-left hover:bg-hover"
              >
                <span className="w-16 shrink-0 text-fs-11 text-text-subtle">
                  {t(`catalog.kind.${b.kind}` as MessageKey)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-medium">{x.title}</span>
                  <span className="ml-2 text-xs text-text-muted">{x.summary}</span>
                </span>
                <span className="shrink-0 text-fs-11 text-text-subtle">{x.category}</span>
              </button>
              {expanded && (
                <div className="mb-3 ml-[5.25rem] space-y-2">
                  {x.detail && <p className="text-xs text-text-muted">{x.detail}</p>}
                  <pre className="selectable max-h-80 overflow-auto rounded-md bg-sunken p-3 font-mono text-fs-12 leading-relaxed whitespace-pre-wrap text-text-muted">
                    {b.body}
                  </pre>
                  <div className="flex items-center gap-3">
                    <Button
                      size="sm"
                      onClick={() =>
                        void navigator.clipboard.writeText(b.body).then(() => {
                          setCopied(b.id);
                          setTimeout(() => setCopied(null), 1500);
                        })
                      }
                    >
                      {copied === b.id ? <Check size={13} /> : <Copy size={13} />}
                      {t(copied === b.id ? "suggest.copied" : "catalog.copy")}
                    </Button>
                    {b.found && (
                      <button
                        type="button"
                        disabled={busy}
                        className="text-fs-11 text-text-subtle hover:text-text"
                        onClick={() => act("catalog_remove_found", b.id.replace(/^found:/, ""))}
                      >
                        {t("catalog.found.remove")}
                      </button>
                    )}
                    {b.origin && (
                      <button
                        type="button"
                        className="text-fs-11 text-text-subtle hover:text-text"
                        onClick={() =>
                          open(
                            `https://github.com/${b.origin?.repo}/blob/${b.origin?.commit}/${b.origin?.path}`,
                          )
                        }
                      >
                        {b.origin.repo} · {b.origin.license}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {list.length === 0 && <p className="py-6 text-xs text-text-subtle">{t("catalog.none")}</p>}
      </ul>
    </div>
  );
}

/** Skills and subagents that appeared upstream next to bundled ones, waiting to be read. */
function FoundList({
  items,
  busy,
  onAccept,
  onDismiss,
}: {
  items: Candidate[];
  busy: boolean;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [openId, setOpenId] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);

  const toggle = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setText(null);
    setText(await invoke<string>("catalog_candidate_text", { id }).catch((e) => String(e)));
  };

  if (items.length === 0) return null;
  return (
    <section className="mb-8">
      <h3 className="mb-1 text-xs font-semibold">
        {t("catalog.found.title")}{" "}
        <span className="font-normal text-text-muted">· {items.length}</span>
      </h3>
      <p className="mb-2 text-fs-11 text-text-subtle">{t("catalog.found.hint")}</p>
      <ul className="space-y-1">
        {items.map((c) => {
          const expanded = openId === c.id;
          return (
            <li key={c.id}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => void toggle(c.id)}
                className="flex w-full items-baseline gap-3 rounded-md px-2 py-2 text-left hover:bg-hover"
              >
                <span className="w-16 shrink-0 text-fs-11 text-text-subtle">
                  {t(`catalog.kind.${c.kind}` as MessageKey)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className="ml-2 line-clamp-1 text-xs text-text-muted">{c.description}</span>
                </span>
                {c.warnings.length > 0 && (
                  <span className="shrink-0 text-fs-11 text-warning">
                    {t("catalog.found.warnings", { n: c.warnings.length })}
                  </span>
                )}
                <span className="shrink-0 text-fs-11 text-text-subtle">
                  {locale === "en" && c.categoryEn ? c.categoryEn : c.category}
                </span>
              </button>
              {expanded && (
                <div className="mb-3 ml-[5.25rem] space-y-2">
                  {c.warnings.map((w) => (
                    <p key={w} className="text-xs text-warning">
                      {w}
                    </p>
                  ))}
                  <pre className="selectable max-h-80 overflow-auto rounded-md bg-sunken p-3 font-mono text-fs-12 leading-relaxed whitespace-pre-wrap text-text-muted">
                    {text ?? "…"}
                  </pre>
                  <div className="flex items-center gap-3">
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy}
                      onClick={() => onAccept(c.id)}
                    >
                      {t("catalog.found.accept")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onDismiss(c.id)}
                    >
                      {t("catalog.found.dismiss")}
                    </Button>
                    <button
                      type="button"
                      className="text-fs-11 text-text-subtle hover:text-text"
                      onClick={() =>
                        open(`https://github.com/${c.repo}/blob/${c.commit}/${c.path}`)
                      }
                    >
                      {c.repo} · {c.license}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
