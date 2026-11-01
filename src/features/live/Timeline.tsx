import { Check, LoaderCircle, X } from "lucide-react";
import { useMemo } from "react";
import { type MessageKey, useLocale, useT } from "../../i18n";
import { type Call, type Session, turnsOf } from "../../store/activity";
import { stateColor } from "./LiveStatus";

const time = (at: number, locale: string) =>
  new Date(at).toLocaleTimeString(locale === "ko" ? "ko-KR" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

/** What a call did, in the reader's words. */
function verb(call: Call): MessageKey {
  const c = call.start.category || "other";
  return `live.verb.${c}` as MessageKey;
}

/**
 * The session's turns, newest first: each prompt, then every tool call under
 * it with its file or command, lines changed and how it ended.
 */
export function Timeline({ session, limit = 60 }: { session: Session; limit?: number }) {
  const t = useT();
  const locale = useLocale();
  const turns = useMemo(() => turnsOf(session.steps).reverse(), [session.steps]);
  let shown = 0;

  if (!turns.length) {
    return <p className="py-6 text-xs text-text-subtle">{t("live.timeline.empty")}</p>;
  }

  return (
    <ol className="space-y-5">
      {turns.map((turn, i) => {
        if (shown >= limit) return null;
        const calls = [...turn.calls].reverse().slice(0, Math.max(0, limit - shown));
        shown += calls.length;
        const open = i === 0 && !turn.ended && session.state !== "ended";
        return (
          <li key={`${turn.id}-${turn.at}`}>
            <div className="flex items-baseline gap-3">
              <span className="w-14 shrink-0 font-mono text-fs-11 text-text-subtle tabular-nums">
                {time(turn.at, locale)}
              </span>
              <p className="selectable min-w-0 flex-1 text-sm leading-snug">
                {turn.prompt ? (
                  <span className="line-clamp-2">{turn.prompt}</span>
                ) : (
                  <span className="text-text-subtle">{t("live.timeline.continued")}</span>
                )}
              </p>
              {turn.ended && (
                <span className="shrink-0 text-fs-11 text-text-subtle">
                  {t("live.timeline.calls", { n: turn.calls.length })}
                </span>
              )}
            </div>
            {calls.length > 0 && (
              <ul className="mt-2 ml-[4.25rem] border-l border-border pl-4">
                {calls.map((call, j) => (
                  <CallRow
                    key={call.start.id || `${call.start.at}-${j}`}
                    call={call}
                    running={open && !call.end}
                    label={t(verb(call))}
                    locale={locale}
                  />
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function CallRow({
  call,
  running,
  label,
  locale,
}: {
  call: Call;
  running: boolean;
  label: string;
  locale: string;
}) {
  const { start, end } = call;
  const color = stateColor(start.category || "other");
  const what = start.target || start.detail || start.tool;
  return (
    <li className="anim-step-in relative flex items-center gap-2.5 py-1 text-xs">
      <span
        className="absolute -left-[1.3rem] size-2 rounded-full ring-2 ring-surface"
        style={{ background: color }}
      />
      <span className="w-16 shrink-0 font-medium" style={{ color }}>
        {start.agent ? `↳ ${label}` : label}
      </span>
      <span
        className="selectable min-w-0 flex-1 truncate font-mono text-text-muted"
        title={[start.tool, start.target, start.detail].filter(Boolean).join("  ")}
      >
        {what}
      </span>
      {end && (end.added > 0 || end.removed > 0) && (
        <span className="shrink-0 font-mono tabular-nums">
          <span className="text-success">+{end.added}</span>{" "}
          <span className="text-danger">−{end.removed}</span>
        </span>
      )}
      <span className="w-4 shrink-0">
        {running ? (
          <LoaderCircle size={12} className="animate-spin text-text-subtle" />
        ) : end?.ok === false ? (
          <X size={12} className="text-danger" />
        ) : end ? (
          <Check size={12} className="text-text-subtle" />
        ) : null}
      </span>
      <span className="hidden w-14 shrink-0 text-right font-mono text-fs-10 text-text-subtle tabular-nums xl:inline">
        {time(start.at, locale)}
      </span>
    </li>
  );
}
