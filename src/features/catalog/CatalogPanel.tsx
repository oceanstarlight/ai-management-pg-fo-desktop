import { invoke, isTauri } from "@tauri-apps/api/core";
import { Check, Copy, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui";
import { type MessageKey, useLocale, useT } from "../../i18n";
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
}

interface RefreshResult {
  updated: string[];
  unchanged: number;
  failed: [string, string][];
}

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

  const load = useCallback(async () => {
    if (!isTauri()) return;
    setBlocks(await invoke<Block[]>("catalog_list").catch(() => []));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

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
          onClick={async () => {
            setBusy(true);
            setNote(null);
            try {
              const r = await invoke<RefreshResult>("catalog_refresh");
              setNote(
                t("catalog.refreshed", {
                  updated: r.updated.length,
                  failed: r.failed.length,
                }),
              );
              await load();
            } catch (e) {
              setNote(String(e));
            }
            setBusy(false);
          }}
        >
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
          {t("catalog.refresh")}
        </Button>
      </div>
      {note && <p className="mb-4 text-xs text-text-muted">{note}</p>}
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
