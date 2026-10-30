import { Check, LoaderCircle, TerminalSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Switch } from "../../components/ui";
import { timeAgo, useT } from "../../i18n";
import { AUTO_PREF, type Live, useLiveStore, useSwitchPref } from "../../store/live";
import { useProjectStore } from "../../store/project";

const base = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
const same = (a: string, b: string | null) =>
  !!b && a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();

/** The prompt being written in Claude Code, its suggestions, and what to do with them. */
export function LivePanel() {
  const t = useT();
  const { sessions, init } = useLiveStore();
  const project = useProjectStore((s) => s.current);
  const [auto, setAuto] = useSwitchPref(AUTO_PREF, false);

  useEffect(() => init(), [init]);

  // The current project's newest session, else the newest of any.
  const live = sessions.find((s) => same(s.project, project)) ?? sessions[0];

  return (
    <section>
      <div className="mb-2 flex items-center gap-2 px-1">
        <h2 className="flex-1 text-xs font-semibold text-text-muted">{t("suggest.live.title")}</h2>
        <span className="text-fs-11 text-text-subtle" title={t("suggest.live.autoHint")}>
          {t("suggest.live.auto")}
        </span>
        <Switch checked={auto} onChange={setAuto} label={t("suggest.live.auto")} />
      </div>
      {live ? (
        <SessionCard live={live} auto={auto} />
      ) : (
        <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-fs-13 text-text-muted">
          {t("suggest.live.empty")}
        </p>
      )}
    </section>
  );
}

function SessionCard({ live, auto }: { live: Live; auto: boolean }) {
  const t = useT();
  const send = useLiveStore((s) => s.send);
  const [refined, setRefined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (command: Parameters<typeof send>[1]) =>
    send(live.session, command).catch((e) => setError(String(e)));

  // A new prompt starts without an undo.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the draft empties
  useEffect(() => {
    if (!live.draft) setRefined(false);
  }, [live.draft === ""]);

  return (
    <div className="rounded-xl border border-border bg-surface-raised px-3 py-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-fs-11 text-text-subtle">
        <TerminalSquare size={12} />
        <span className="truncate">{base(live.project) || live.surface}</span>
        <span className="ml-auto shrink-0">{timeAgo(live.at / 1000)}</span>
      </div>
      {live.draft ? (
        <p className="selectable line-clamp-4 text-fs-13 whitespace-pre-wrap text-text">
          {live.draft}
        </p>
      ) : (
        <p className="text-fs-13 text-text-subtle">{t("suggest.live.idle")}</p>
      )}

      {live.draft && (
        <div className="mt-2 flex items-center gap-1.5 text-fs-11 text-text-subtle">
          {live.pending && <LoaderCircle size={11} className="animate-spin" />}
          {live.pending
            ? t("suggest.picking")
            : live.items.length > 0
              ? t(live.by === "ai" ? "suggest.byAi" : "suggest.byKeyword")
              : null}
        </div>
      )}

      {live.items.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {live.items.map((item) => {
            const done = live.picked.includes(item.key);
            return (
              <li key={item.key} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-fs-12 font-medium">{item.label}</div>
                  {item.description && (
                    <div className="line-clamp-1 text-fs-11 text-text-muted">
                      {item.description}
                    </div>
                  )}
                </div>
                {done ? (
                  <span className="flex shrink-0 items-center gap-1 text-fs-11 text-success">
                    <Check size={12} />
                    {t("suggest.live.allowed")}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant={auto ? "ghost" : "primary"}
                    onClick={() => void run({ op: "pick", key: item.key })}
                  >
                    {t("suggest.live.allow")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {live.draft && (
        <div className="mt-2 flex gap-1.5">
          <Button
            size="sm"
            onClick={() => {
              setRefined(true);
              void run({ op: "refine" });
            }}
          >
            {t("suggest.live.refine")}
          </Button>
          {refined && (
            <Button size="sm" variant="ghost" onClick={() => void run({ op: "undo" })}>
              {t("suggest.live.undo")}
            </Button>
          )}
        </div>
      )}
      {error && <p className="selectable mt-1 text-fs-11 text-danger">{error}</p>}
    </div>
  );
}
