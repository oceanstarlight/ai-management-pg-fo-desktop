import { Check, ChevronDown, ChevronRight, LoaderCircle, X } from "lucide-react";
import { useMemo, useState } from "react";
import { type MessageKey, useLocale, useT } from "../../i18n";
import { type Call, type Session, type Turn, turnsOf } from "../../store/activity";
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

/** Turns shown before "show earlier". */
const TURNS = 6;

type Part = { key: string; category: string; n: number };

/** A turn's calls as a short summary: files read, edits, searches… (in that order). */
function summarize(calls: Call[]): Part[] {
  const unique = (cat: string) =>
    new Set(calls.filter((c) => c.start.category === cat).map((c) => c.start.target || c.start.id))
      .size;
  const count = (cats: string[]) => calls.filter((c) => cats.includes(c.start.category)).length;
  const parts: Part[] = [
    { key: "live.sum.ask", category: "ask", n: count(["ask"]) },
    { key: "live.sum.read", category: "read", n: unique("read") },
    { key: "live.sum.edit", category: "edit", n: unique("edit") },
    { key: "live.sum.search", category: "search", n: count(["search"]) },
    { key: "live.sum.web", category: "web", n: count(["web"]) },
    { key: "live.sum.run", category: "run", n: count(["run"]) },
    { key: "live.sum.agent", category: "agent", n: count(["agent"]) },
    { key: "live.sum.mcp", category: "mcp", n: count(["mcp"]) },
    { key: "live.sum.other", category: "other", n: count(["other", "plan", ""]) },
  ];
  return parts.filter((p) => p.n > 0);
}

/**
 * The session's turns, newest first, the way Claude Code's app shows them:
 * the prompt, one line summing up its tool calls (open it for each call),
 * the call running now, and Claude's answer.
 */
export function Timeline({ session, limit = TURNS }: { session: Session; limit?: number }) {
  const t = useT();
  const locale = useLocale();
  const turns = useMemo(() => turnsOf(session.steps).reverse(), [session.steps]);
  const [more, setMore] = useState(0);

  if (!turns.length) {
    return <p className="py-6 text-xs text-text-subtle">{t("live.timeline.empty")}</p>;
  }
  const shown = turns.slice(0, limit + more);

  return (
    <div>
      <ol className="space-y-6">
        {shown.map((turn, i) => (
          <TurnRow
            key={`${turn.id}-${turn.at}`}
            turn={turn}
            open={i === 0 && !turn.ended && session.state !== "ended"}
            locale={locale}
          />
        ))}
      </ol>
      {turns.length > shown.length && (
        <button
          type="button"
          onClick={() => setMore(more + limit)}
          className="mt-5 ml-[4.25rem] text-fs-12 text-text-subtle hover:text-text"
        >
          {t("live.timeline.earlier", { n: turns.length - shown.length })}
        </button>
      )}
    </div>
  );
}

function TurnRow({ turn, open, locale }: { turn: Turn; open: boolean; locale: string }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const parts = summarize(turn.calls);
  const running = open ? turn.calls.filter((c) => !c.end) : [];
  const asks = turn.calls.filter((c) => c.start.category === "ask");

  return (
    <li>
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
      </div>

      <div className="mt-1.5 ml-[4.25rem] space-y-1">
        {parts.length > 0 && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            className="group flex max-w-full items-center gap-1.5 text-left text-fs-12 text-text-muted hover:text-text"
          >
            {expanded ? (
              <ChevronDown size={13} className="shrink-0" />
            ) : (
              <ChevronRight size={13} className="shrink-0" />
            )}
            <span className="min-w-0 truncate">
              {parts.map((p, j) => (
                <span key={p.key}>
                  {j > 0 && <span className="text-text-subtle"> · </span>}
                  <span style={p.category === "ask" ? { color: stateColor("ask") } : undefined}>
                    {t(p.key as MessageKey, { n: p.n })}
                  </span>
                </span>
              ))}
            </span>
            {open && <LoaderCircle size={12} className="shrink-0 animate-spin text-text-subtle" />}
          </button>
        )}

        {expanded ? (
          <ul className="border-l border-border pl-4">
            {turn.calls.map((call, j) => (
              <CallRow
                key={call.start.id || `${call.start.at}-${j}`}
                call={call}
                running={open && !call.end}
                locale={locale}
              />
            ))}
          </ul>
        ) : (
          // Closed: only what runs now, and the questions Claude asks.
          (running.length > 0 || asks.length > 0) && (
            <ul className="border-l border-border pl-4">
              {[...new Set([...asks, ...running.slice(-3)])].map((call, j) => (
                <CallRow
                  key={call.start.id || `${call.start.at}-${j}`}
                  call={call}
                  running={open && !call.end}
                  locale={locale}
                />
              ))}
            </ul>
          )
        )}
      </div>

      {turn.answer && <Answer text={turn.answer} />}
    </li>
  );
}

/** Claude's answer under its prompt: the first lines, the rest on request. */
function Answer({ text }: { text: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const long = text.split("\n").length > 3 || text.length > 240;
  return (
    <div className="mt-2 ml-[4.25rem]">
      <p
        className={`selectable text-fs-13 leading-relaxed whitespace-pre-wrap text-text-muted ${
          open ? "" : "line-clamp-3"
        }`}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="mt-1 text-fs-12 text-text-subtle hover:text-text"
        >
          {t(open ? "live.answer.less" : "live.answer.more")}
        </button>
      )}
    </div>
  );
}

function CallRow({ call, running, locale }: { call: Call; running: boolean; locale: string }) {
  const t = useT();
  const { start, end } = call;
  const color = stateColor(start.category || "other");
  const label = t(verb(call));
  const what =
    start.category === "ask" ? t("live.ask.what") : start.target || start.detail || start.tool;
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
