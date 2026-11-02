import { type CSSProperties, useEffect, useRef, useState } from "react";
import { type MessageKey, useT } from "../../i18n";
import type { Session, State } from "../../store/activity";

/** The colour for a state: a tool kind's, or quiet for idle and thinking. */
export function stateColor(state: State | ""): string {
  if (state === "idle" || state === "ended" || state === "") return "var(--c-text-subtle)";
  if (state === "thinking") return "var(--c-accent)";
  return `var(--c-act-${state})`;
}

export function stateLabel(state: State): MessageKey {
  return `live.state.${state}` as MessageKey;
}

/** How long "종료됨" shows before the session reads as idle. */
const STOPPED_MS = 3000;

/**
 * The state to show: an ended session, or a turn that was interrupted, reads
 * "ended" for a moment and then idle.
 */
export function useShownState(session: Session): State {
  const { state, at } = session;
  const stopped = session.stoppedAt ?? null;
  const since = state === "ended" ? at : state === "idle" ? stopped : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since == null) return;
    const left = since + STOPPED_MS - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), left + 20);
    return () => clearTimeout(timer);
  }, [since]);
  if (since == null) return state;
  return Math.max(now, Date.now()) - since < STOPPED_MS ? "ended" : "idle";
}

/**
 * How fast a change of state blends: quick when states follow each other
 * fast, slower and softer when they are far apart (ms).
 */
export function useBlend(key: string): number {
  const last = useRef({ key, at: Date.now(), dur: 420 });
  if (last.current.key !== key) {
    const now = Date.now();
    const gap = now - last.current.at;
    last.current = { key, at: now, dur: Math.round(Math.min(700, Math.max(140, gap * 0.3))) };
  }
  return last.current.dur;
}

/** Transitions colour, glow and opacity at the given speed. */
export const blendStyle = (ms: number): CSSProperties => ({
  transitionProperty: "background-color, box-shadow, color, opacity, transform, border-color",
  transitionDuration: `${ms}ms`,
  transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
});

/**
 * A small animated mark for what Claude is doing: still when idle, dots
 * circling while it thinks, a pulse in the tool's colour while a tool runs.
 * Every layer stays mounted and blends, so changes of state melt into each other.
 */
export function StatusOrb({ state, size = 56 }: { state: State; size?: number }) {
  const color = stateColor(state);
  const busy = state !== "idle" && state !== "ended";
  const tool = busy && state !== "thinking";
  const blend = blendStyle(useBlend(state));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <span className="absolute inset-0" style={{ ...blend, opacity: tool ? 1 : 0 }}>
        <span
          className="anim-pulse-ring absolute inset-[22%] rounded-full"
          style={{ ...blend, background: color }}
        />
      </span>
      <span
        className={`absolute inset-[22%] rounded-full ${busy ? "anim-breathe" : ""}`}
        style={{
          ...blend,
          background: busy ? color : "transparent",
          boxShadow: busy
            ? `0 0 ${size / 3}px ${color}, inset 0 0 0 1.5px ${color}`
            : `0 0 0 transparent, inset 0 0 0 1.5px ${color}`,
          opacity: state === "ended" ? 0.5 : 1,
        }}
      />
      <span
        className="absolute inset-0"
        style={{
          ...blend,
          opacity: state === "thinking" ? 1 : 0,
          transform: state === "thinking" ? "none" : "scale(0.6)",
        }}
      >
        <span className="anim-orbit absolute inset-0" style={{ ["--orbit" as string]: "2.4s" }}>
          {[0, 120, 240].map((deg) => (
            <span
              key={deg}
              className="absolute top-1/2 left-1/2 size-1.5 rounded-full"
              style={{
                background: stateColor("thinking"),
                transform: `rotate(${deg}deg) translate(${size / 2 - 3}px) translate(-50%, -50%)`,
                opacity: 0.4 + deg / 600,
              }}
            />
          ))}
        </span>
      </span>
    </div>
  );
}

/** Text that cross-fades when it changes, at the blend's speed. */
export function Blended({
  text,
  ms,
  className,
  style,
}: {
  text: string;
  ms: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      key={text}
      className={`anim-blend-in inline-block ${className ?? ""}`}
      style={{ ...blendStyle(ms), ["--blend" as string]: `${ms}ms`, ...style }}
    >
      {text}
    </span>
  );
}

/** Seconds since `from`, ticking every second while `on`. */
function useElapsed(from: number | null, on: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
  return from ? Math.max(0, Math.floor(((on ? now : Date.now()) - from) / 1000)) : null;
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m >= 60
    ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/** The orb, what is happening in words, and this turn's numbers. */
export function LiveStatus({ session, compact = false }: { session: Session; compact?: boolean }) {
  const t = useT();
  const state = useShownState(session);
  const busy = state !== "idle" && state !== "ended";
  const blend = useBlend(state);
  const elapsed = useElapsed(session.turnStarted, busy);
  const c = session.turn;
  const numbers: [string, string, string?][] = [
    [t("live.metric.tools"), String(c.tools)],
    [t("live.metric.reads"), String(c.reads)],
    [t("live.metric.edits"), String(c.edits)],
    [t("live.metric.lines"), `+${c.added} −${c.removed}`, "var(--c-act-edit)"],
    [t("live.metric.commands"), String(c.commands)],
  ];
  if (c.failed) numbers.push([t("live.metric.failed"), String(c.failed), "var(--c-danger)"]);
  if (session.usage.contextPercent != null)
    numbers.push([t("live.metric.context"), `${Math.round(session.usage.contextPercent)}%`]);
  if (session.usage.costUsd != null)
    numbers.push([
      t(session.usage.costEstimated ? "live.metric.costEstimated" : "live.metric.cost"),
      `${session.usage.costEstimated ? "~" : ""}$${session.usage.costUsd.toFixed(2)}`,
    ]);

  return (
    <div className={compact ? "space-y-3" : "flex flex-wrap items-center gap-x-8 gap-y-4"}>
      <div className="flex min-w-0 items-center gap-4">
        <StatusOrb state={state} size={compact ? 40 : 56} />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <Blended
              text={t(stateLabel(state))}
              ms={blend}
              className={`${compact ? "text-sm" : "text-fs-17"} font-semibold`}
              style={{ color: busy ? stateColor(state) : "var(--c-text)" }}
            />
            {elapsed != null && (
              <span className="font-mono text-xs text-text-subtle tabular-nums">
                {clock(elapsed)}
              </span>
            )}
          </div>
          <div className="selectable mt-0.5 truncate font-mono text-xs text-text-muted">
            {session.doing || (session.state === "idle" ? t("live.waiting") : " ")}
          </div>
        </div>
      </div>
      <dl
        className={`flex flex-wrap gap-x-5 gap-y-1.5 ${compact ? "" : "ml-auto"} text-xs`}
        aria-label={t("live.metric.label")}
      >
        {numbers.map(([label, value, color]) => (
          <div key={label} className="flex items-baseline gap-1.5">
            <dt className="text-text-subtle">{label}</dt>
            <dd className="font-mono tabular-nums" style={{ color }}>
              <span key={value} className="anim-tick inline-block">
                {value}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
