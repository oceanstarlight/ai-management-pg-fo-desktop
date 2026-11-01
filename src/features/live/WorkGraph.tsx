import {
  Bot,
  Check,
  FileText,
  Globe,
  type LucideIcon,
  MessageCircleQuestion,
  Plug,
  Search,
  Wrench,
} from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import type { Session } from "../../store/activity";
import { type AgentNode, buildGraph, type ResourceKind, type ResourceNode } from "./graph";
import { StatusOrb, stateColor, stateLabel } from "./LiveStatus";

// Sizes in layout pixels; the whole drawing scales down to fit.
const NODE_W = 152;
const MAIN_W = 200;
const MAIN_H = 56;
const AGENT_H = 46;
const RES_H = 30;
const GAP_X = 12;
const LEVEL_GAP = 58;
const RES_TOP = 22;
const RES_GAP = 8;
const INDENT = 18;
const MIN_W = 520;

const ICON: Record<ResourceKind, LucideIcon> = {
  file: FileText,
  web: Globe,
  search: Search,
  mcp: Plug,
  ask: MessageCircleQuestion,
  other: Wrench,
};

/** The column of work Claude does itself, when it also runs subagents. */
const OWN = "main";

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Edge {
  id: string;
  d: string;
  color: string;
  active: boolean;
}

interface Layout {
  width: number;
  height: number;
  main: Box;
  heads: (Box & { agent: AgentNode | null; hidden: number })[];
  res: (Box & { node: ResourceNode })[];
  edges: Edge[];
}

/** Places Claude on top, its subagents (or its own work) in a row, and their work under each. */
function layout(
  agents: AgentNode[],
  resources: ResourceNode[],
  hidden: Record<string, number>,
): Layout {
  const own = resources.filter((r) => r.parent === "main");
  const edges: Edge[] = [];
  const res: Layout["res"] = [];
  const heads: Layout["heads"] = [];
  const level1 = MAIN_H + LEVEL_GAP;

  // Claude alone: its work in a row right under it.
  if (agents.length === 0) {
    const n = Math.max(own.length, 1);
    const width = Math.max(MIN_W, n * NODE_W + (n - 1) * GAP_X);
    const main = { id: "main", x: (width - MAIN_W) / 2, y: 0, w: MAIN_W, h: MAIN_H };
    const left = (width - (own.length * NODE_W + (own.length - 1) * GAP_X)) / 2;
    own.forEach((node, i) => {
      const box = { id: node.id, x: left + i * (NODE_W + GAP_X), y: level1, w: NODE_W, h: RES_H };
      res.push({ ...box, node });
      edges.push({
        id: `e:${node.id}`,
        d: curve(main.x + MAIN_W / 2, MAIN_H, box.x + NODE_W / 2, box.y),
        color: stateColor(node.category),
        active: node.active,
      });
    });
    const more = hidden.main ?? 0;
    return { width, height: level1 + RES_H + (more ? 26 : 8), main, heads, res, edges };
  }

  // Subagents in a row (Claude's own work first, as a column of its own).
  const columns: (AgentNode | null)[] = [...(own.length ? [null] : []), ...agents];
  const n = columns.length;
  const width = Math.max(MIN_W, n * NODE_W + (n - 1) * GAP_X);
  const main = { id: "main", x: (width - MAIN_W) / 2, y: 0, w: MAIN_W, h: MAIN_H };
  let height = level1 + AGENT_H;
  columns.forEach((agent, i) => {
    const x = i * (NODE_W + GAP_X);
    const parent = agent?.id ?? OWN;
    const head = { id: `h:${parent}`, x, y: level1, w: NODE_W, h: AGENT_H };
    const mine = resources.filter((r) => r.parent === parent);
    heads.push({ ...head, agent, hidden: hidden[parent] ?? 0 });
    const headActive = agent ? agent.active : mine.some((r) => r.active);
    edges.push({
      id: `e:${head.id}`,
      d: curve(main.x + MAIN_W / 2, MAIN_H, x + NODE_W / 2, level1),
      color: agent ? stateColor("agent") : "var(--c-accent)",
      active: headActive,
    });
    mine.forEach((node, k) => {
      const y = level1 + AGENT_H + RES_TOP + k * (RES_H + RES_GAP);
      const box = { id: node.id, x: x + INDENT, y, w: NODE_W - INDENT, h: RES_H };
      res.push({ ...box, node });
      const trunk = x + 9;
      edges.push({
        id: `e:${node.id}`,
        d: `M ${trunk} ${level1 + AGENT_H} L ${trunk} ${y + RES_H / 2 - 6} Q ${trunk} ${y + RES_H / 2} ${trunk + 6} ${y + RES_H / 2} L ${box.x} ${y + RES_H / 2}`,
        color: stateColor(node.category),
        active: node.active,
      });
      height = Math.max(height, y + RES_H);
    });
    if (hidden[parent])
      height = Math.max(height, level1 + AGENT_H + RES_TOP + mine.length * (RES_H + RES_GAP) + 14);
  });
  return { width, height: height + 8, main, heads, res, edges };
}

/** A soft S-curve from a parent's bottom to a child's top. */
function curve(x1: number, y1: number, x2: number, y2: number): string {
  const mid = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
}

/** Keeps what just left for a moment so it can fade out. */
function usePresence<T extends { id: string }>(
  items: T[],
  ms = 450,
): (T & { leaving?: boolean })[] {
  const last = useRef(new Map<string, T>());
  const leaving = useRef(new Map<string, { item: T; until: number }>());
  const [, bump] = useState(0);
  const now = Date.now();
  const ids = new Set(items.map((i) => i.id));
  for (const [id, item] of last.current) {
    if (!ids.has(id) && !leaving.current.has(id))
      leaving.current.set(id, { item, until: now + ms });
  }
  for (const id of ids) leaving.current.delete(id);
  last.current = new Map(items.map((i) => [i.id, i]));
  const gone = [...leaving.current.entries()].filter(([, v]) => v.until > now);
  for (const [id, v] of leaving.current) if (v.until <= now) leaving.current.delete(id);
  useEffect(() => {
    if (!gone.length) return;
    const t = setTimeout(() => bump((n) => n + 1), ms);
    return () => clearTimeout(t);
  });
  return [...items, ...gone.map(([, v]) => ({ ...v.item, leaving: true }))];
}

/**
 * Claude's whole work for the current prompt: Claude on top, the subagents it
 * started under it, and what each one reads, edits, looks up or calls under
 * those. Lines with something moving along them are working now.
 */
export function WorkGraph({ session }: { session: Session }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  const running = session.state !== "idle" && session.state !== "ended";

  // Finished work gives way after a while: look again every second.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const graph = useMemo(() => buildGraph(session, now), [session, now]);
  const plan = useMemo(() => layout(graph.agents, graph.resources, graph.hidden), [graph]);

  // Scales the drawing down to the space it has.
  const wrap = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setRoom(e?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = room ? Math.min(1, room / plan.width) : 1;
  const offset = room > plan.width ? (room - plan.width) / 2 : 0;

  const edges = usePresence(plan.edges);
  const heads = usePresence(plan.heads);
  const res = usePresence(plan.res);

  if (session.state === "ended") return null;

  return (
    <div ref={wrap} className="relative w-full" style={{ height: plan.height * scale }}>
      <div
        className="absolute top-0 origin-top-left"
        style={{
          left: offset,
          width: plan.width,
          height: plan.height,
          transform: `scale(${scale})`,
        }}
      >
        <svg
          width={plan.width}
          height={plan.height}
          className="absolute inset-0 overflow-visible"
          aria-hidden
        >
          {edges.map((e) => (
            <g key={e.id} className={e.leaving ? "anim-node-out" : "anim-node-in"}>
              <path
                d={e.d}
                fill="none"
                stroke={e.active ? e.color : "var(--c-border-strong)"}
                strokeOpacity={e.active ? 0.55 : 0.9}
                strokeWidth={e.active ? 1.6 : 1.2}
                strokeDasharray={e.active ? undefined : "3 4"}
              />
              {e.active && !e.leaving && <Packets d={e.d} color={e.color} />}
            </g>
          ))}
        </svg>

        <MainNode box={plan.main} session={session} />

        {heads.map((h) => (
          <Positioned key={h.id} box={h} leaving={h.leaving}>
            {h.agent ? (
              <AgentCard agent={h.agent} hidden={h.hidden} />
            ) : (
              <OwnCard
                active={graph.resources.some((r) => r.parent === "main" && r.active)}
                hidden={h.hidden}
              />
            )}
          </Positioned>
        ))}

        {res.map((r) => (
          <Positioned key={r.id} box={r} leaving={r.leaving}>
            <ResourceChip
              node={r.node}
              label={r.node.kind === "ask" ? t("live.ask.what") : r.node.label}
            />
          </Positioned>
        ))}

        {graph.agents.length === 0 && (graph.hidden.main ?? 0) > 0 && (
          <span
            className="absolute text-fs-11 text-text-subtle"
            style={{ left: plan.width / 2 - 30, top: MAIN_H + LEVEL_GAP + RES_H + 6 }}
          >
            {t("live.graph.more", { n: graph.hidden.main ?? 0 })}
          </span>
        )}
      </div>
    </div>
  );
}

/** Small blocks running along a working line, toward what it works on. */
function Packets({ d, color }: { d: string; color: string }) {
  return (
    <g className="motion-reduce:hidden">
      {[0, 1, 2].map((i) => (
        <rect key={i} width={7} height={3.5} rx={1.5} x={-3.5} y={-1.75} fill={color}>
          <animateMotion
            dur="1.5s"
            repeatCount="indefinite"
            begin={`${-i * 0.5}s`}
            path={d}
            rotate="auto"
          />
        </rect>
      ))}
    </g>
  );
}

function Positioned({
  box,
  leaving,
  children,
}: {
  box: Box;
  leaving?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`absolute transition-[left,top] duration-300 ${leaving ? "anim-node-out" : "anim-node-in"}`}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
    >
      {children}
    </div>
  );
}

function MainNode({ box, session }: { box: Box; session: Session }) {
  const t = useT();
  const color = stateColor(session.state);
  return (
    <div
      className="absolute flex items-center gap-2.5 rounded-xl bg-surface-raised px-3 shadow-card"
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        boxShadow: `inset 0 0 0 1px ${session.state === "idle" ? "var(--c-border)" : color}`,
      }}
    >
      <StatusOrb state={session.state} size={32} />
      <div className="min-w-0">
        <div className="text-sm font-semibold">Claude</div>
        <div className="truncate text-fs-11" style={{ color }}>
          {t(stateLabel(session.state))}
        </div>
      </div>
    </div>
  );
}

function AgentCard({ agent, hidden }: { agent: AgentNode; hidden: number }) {
  const t = useT();
  const color = stateColor("agent");
  return (
    <div
      className="flex h-full items-center gap-2 rounded-lg bg-surface-raised px-2.5"
      style={{ boxShadow: `inset 0 0 0 1px ${agent.active ? color : "var(--c-border)"}` }}
      title={agent.label}
    >
      <Bot
        size={15}
        className="shrink-0"
        style={{ color: agent.active ? color : "var(--c-text-subtle)" }}
      />
      <div className="min-w-0 flex-1">
        <div className={`truncate text-fs-12 font-medium ${agent.active ? "" : "text-text-muted"}`}>
          {agent.label || t("live.graph.agent")}
        </div>
        <div className="truncate text-fs-10.5 text-text-subtle">
          {agent.active ? t("live.graph.working") : t("live.graph.done")}
          {agent.calls > 0 && ` · ${t("live.graph.calls", { n: agent.calls })}`}
          {hidden > 0 && ` · ${t("live.graph.more", { n: hidden })}`}
        </div>
      </div>
      {!agent.active && <Check size={13} className="shrink-0 text-text-subtle" />}
    </div>
  );
}

function OwnCard({ active, hidden }: { active: boolean; hidden: number }) {
  const t = useT();
  return (
    <div
      className="flex h-full items-center gap-2 rounded-lg px-2.5"
      style={{ boxShadow: `inset 0 0 0 1px ${active ? "var(--c-accent)" : "var(--c-border)"}` }}
    >
      <div className="min-w-0">
        <div className="truncate text-fs-12 font-medium">{t("live.graph.own")}</div>
        {hidden > 0 && (
          <div className="text-fs-10.5 text-text-subtle">{t("live.graph.more", { n: hidden })}</div>
        )}
      </div>
    </div>
  );
}

function ResourceChip({ node, label }: { node: ResourceNode; label: string }) {
  const t = useT();
  const Icon = ICON[node.kind];
  const color = stateColor(node.category);
  return (
    <div
      className="flex h-full items-center gap-1.5 rounded-md bg-sunken px-2 text-fs-11"
      style={{ boxShadow: node.active ? `inset 0 0 0 1px ${color}` : undefined }}
      title={node.title}
    >
      <Icon size={12} className="shrink-0" style={{ color }} />
      <span className={`min-w-0 flex-1 truncate ${node.active ? "text-text" : "text-text-muted"}`}>
        {label}
      </span>
      {node.category === "edit" && (
        <span className="shrink-0 text-fs-10" style={{ color }}>
          {t("live.verb.edit")}
        </span>
      )}
    </div>
  );
}
