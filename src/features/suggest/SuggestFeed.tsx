import { ask } from "@tauri-apps/plugin-dialog";
import { Trash2 } from "lucide-react";
import { useEffect } from "react";
import { IconButton } from "../../components/ui";
import { timeAgo, useLocale, useT } from "../../i18n";
import { itemName, type LogEntry, useSuggestStore } from "../../store/suggest";

const base = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** What the Claude Code mod suggested for each prompt sent, newest first. */
export function SuggestFeed({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const { overview, loadOverview, clearLog } = useSuggestStore();

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const log = compact ? overview.log.slice(0, 30) : overview.log;

  return (
    <section>
      <div className="mb-2 flex items-center gap-2 px-1">
        <h2 className="flex-1 text-xs font-semibold text-text-muted">{t("suggest.feed.title")}</h2>
        {log.length > 0 && (
          <IconButton
            label={t("suggest.feed.clear")}
            className="size-6! text-text-subtle"
            onClick={async () => {
              const ok = await ask(t("suggest.feed.clearConfirm"), { kind: "warning" }).catch(
                () => false,
              );
              if (ok) void clearLog();
            }}
          >
            <Trash2 size={13} />
          </IconButton>
        )}
      </div>
      {log.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-fs-13 text-text-muted">
          {t("suggest.feed.empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {log.map((entry) => (
            <FeedEntry key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FeedEntry({ entry }: { entry: LogEntry }) {
  const t = useT();
  const locale = useLocale();
  return (
    <li className="rounded-xl border border-border bg-surface-raised px-3 py-2.5">
      <div className="mb-1 flex items-center gap-2 text-fs-11 text-text-subtle">
        <span>{entry.by === "ai" ? "✨" : "💡"}</span>
        {entry.project && <span className="truncate">{base(entry.project)}</span>}
        <span className="ml-auto shrink-0">{timeAgo(entry.at / 1000)}</span>
      </div>
      <p className="selectable line-clamp-2 text-fs-13 text-text">{entry.draft}</p>
      {entry.items.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {entry.items.map((item) => {
            const picked = entry.picked.includes(item.key);
            return (
              <span
                key={item.key}
                title={picked ? t("suggest.feed.picked") : undefined}
                className={`rounded-full px-2 py-px text-fs-11 ${
                  picked
                    ? "bg-accent text-accent-fg"
                    : "border border-border bg-sunken text-text-muted"
                }`}
              >
                {itemName(item, locale)}
              </span>
            );
          })}
        </div>
      )}
    </li>
  );
}
