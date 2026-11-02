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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import type { Session } from "../../store/activity";
import { ALPHA_ALIVE, ALPHA_MIN, type Body, extent, type SimNode, seed, step } from "./forceLayout";
import { type AgentNode, buildGraph, type ResourceKind, type ResourceNode } from "./graph";
import {
  Blended,
  blendStyle,
  StatusOrb,
  stateColor,
  stateLabel,
  useBlend,
  useShownState,
} from "./LiveStatus";

// Box sizes in pixels.
const MAIN_W = 200;
const MAIN_H = 56;
const HEAD_W = 152;
const HEAD_H = 46;
const RES_W = 138;
const RES_H = 30;
/** Narrower than this and the graph lays out as if it had this much room. */
const MIN_W = 360;
/** Fade-out of what leaves (ms). */
const LEAVE_MS = 450;

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

type GraphNode = SimNode &
  (
    | { kind: "main" }
    | { kind: "head"; agent: AgentNode | null; hidden: number; active: boolean }
    | { kind: "res"; node: ResourceNode }
  );

interface Edge {
  id: string;
  from: string;
  to: string;
  color: string;
  active: boolean;
}

/** Claude, its subagents (and its own work when it has some), and what each works on. */
function nodesOf(
  agents: AgentNode[],
  resources: ResourceNode[],
  hidden: Record<string, number>,
): { nodes: GraphNode[]; edges: Edge[] } {
  const nodes: GraphNode[] = [
    { id: "main", kind: "main", w: MAIN_W, h: MAIN_H, parent: null, depth: 0 },
  ];
  const edges: Edge[] = [];
  const own = resources.filter((r) => r.parent === "main");

  if (agents.length === 0) {
    for (const node of own) {
      nodes.push({ id: node.id, kind: "res", node, w: RES_W, h: RES_H, parent: "main", depth: 1 });
      edges.push({
        id: `e:${node.id}`,
        from: "main",
        to: node.id,
        color: stateColor(node.category),
        active: node.active,
      });
    }
    return { nodes, edges };
  }

  const heads: (AgentNode | null)[] = [...(own.length ? [null] : []), ...agents];
  for (const agent of heads) {
    const parent = agent?.id ?? OWN;
    const id = `h:${parent}`;
    const mine = resources.filter((r) => r.parent === parent);
    const active = agent ? agent.active : mine.some((r) => r.active);
    nodes.push({
      id,
      kind: "head",
      agent,
      hidden: hidden[parent] ?? 0,
      active,
      w: HEAD_W,
      h: HEAD_H,
      parent: "main",
      depth: 1,
    });
    edges.push({
      id: `e:${id}`,
      from: "main",
      to: id,
      color: agent ? stateColor("agent") : "var(--c-accent)",
      active,
    });
    for (const node of mine) {
      nodes.push({ id: node.id, kind: "res", node, w: RES_W, h: RES_H, parent: id, depth: 2 });
      edges.push({
        id: `e:${node.id}`,
        from: id,
        to: node.id,
        color: stateColor(node.category),
        active: node.active,
      });
    }
  }
  return { nodes, edges };
}

/** Keeps what just left for a moment so it can fade out. */
function usePresence<T extends { id: string }>(items: T[]): (T & { leaving?: boolean })[] {
  const last = useRef(new Map<string, T>());
  const leaving = useRef(new Map<string, { item: T; until: number }>());
  const [, bump] = useState(0);
  const now = Date.now();
  const ids = new Set(items.map((i) => i.id));
  for (const [id, item] of last.current) {
    if (!ids.has(id) && !leaving.current.has(id))
      leaving.current.set(id, { item, until: now + LEAVE_MS });
  }
  for (const id of ids) leaving.current.delete(id);
  last.current = new Map(items.map((i) => [i.id, i]));
  const gone = [...leaving.current.entries()].filter(([, v]) => v.until > now);
  for (const [id, v] of leaving.current) if (v.until <= now) leaving.current.delete(id);
  useEffect(() => {
    if (!gone.length) return;
    const t = setTimeout(() => bump((n) => n + 1), LEAVE_MS);
    return () => clearTimeout(t);
  });
  return [...items, ...gone.map(([, v]) => ({ ...v.item, leaving: true }))];
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

interface Geo {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
}

/**
 * A soft curve from parent to child: bottom to top when the child hangs
 * below, side to side while it sits beside its parent.
 */
function geometry(p: Body, pn: SimNode, c: Body, cn: SimNode): Geo {
  if (c.y - cn.h / 2 >= p.y + pn.h / 2 - 4) {
    const y0 = p.y + pn.h / 2;
    const y3 = c.y - cn.h / 2;
    const my = (y0 + y3) / 2;
    return { x0: p.x, y0, x1: p.x, y1: my, x2: c.x, y2: my, x3: c.x, y3 };
  }
  const dir = c.x >= p.x ? 1 : -1;
  const x0 = p.x + (dir * pn.w) / 2;
  const x3 = c.x - (dir * cn.w) / 2;
  const mx = (x0 + x3) / 2;
  return { x0, y0: p.y, x1: mx, y1: p.y, x2: mx, y2: c.y, x3, y3: c.y };
}

const pathOf = (g: Geo) => `M ${g.x0} ${g.y0} C ${g.x1} ${g.y1}, ${g.x2} ${g.y2}, ${g.x3} ${g.y3}`;

/** A point on the line at `t` (0-1), and the line's angle there (degrees). */
function pointAt(g: Geo, t: number): { x: number; y: number; angle: number } {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  const x = a * g.x0 + b * g.x1 + c * g.x2 + d * g.x3;
  const y = a * g.y0 + b * g.y1 + c * g.y2 + d * g.y3;
  const dx = 3 * u * u * (g.x1 - g.x0) + 6 * u * t * (g.x2 - g.x1) + 3 * t * t * (g.x3 - g.x2);
  const dy = 3 * u * u * (g.y1 - g.y0) + 6 * u * t * (g.y2 - g.y1) + 3 * t * t * (g.y3 - g.y2);
  return { x, y, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/**
 * Claude's whole work for the current prompt: Claude, the subagents it
 * started, and what each one reads, edits, looks up or calls. Every node
 * finds its own place (a small force layout), springs out of its parent when
 * it appears and drifts gently while Claude works; lines with something
 * moving along them are working now.
 */
export function WorkGraph({ session }: { session: Session }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  const shown = useShownState(session);
  const running = shown !== "idle" && shown !== "ended";

  // Finished work gives way after a while: look again every second.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const graph = useMemo(() => buildGraph(session, now), [session, now]);
  const { nodes: current, edges: currentEdges } = useMemo(
    () => nodesOf(graph.agents, graph.resources, graph.hidden),
    [graph],
  );
  const nodes = usePresence(current);
  const edges = usePresence(currentEdges);

  // The room it has.
  const wrap = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setRoom(e?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const width = Math.max(room, MIN_W);
  const scale = room && room < MIN_W ? room / MIN_W : 1;

  // The layout: bodies kept across renders, warmed up when the graph changes.
  const sim = useRef({ bodies: new Map<string, Body>(), alpha: 1, sig: "", t: 0 });
  const live = current;
  const signature = live.map((n) => n.id).join("|");
  const s = sim.current;
  if (room && s.sig !== `${signature}@${width}`) {
    const siblings = new Map<string | null, string[]>();
    for (const n of live) siblings.set(n.parent, [...(siblings.get(n.parent) ?? []), n.id]);
    for (const n of live) {
      if (s.bodies.has(n.id)) continue;
      const group = siblings.get(n.parent) ?? [];
      s.bodies.set(n.id, seed(n, s.bodies, group.length, group.indexOf(n.id), width));
    }
    s.alpha = Math.max(s.alpha, s.sig ? 0.7 : 1);
    s.sig = `${signature}@${width}`;
    if (reducedMotion()) {
      for (let i = 0; i < 300; i++) step(live, s.bodies, width, 1 - i / 300, 0, false);
      s.alpha = 0;
    }
  }
  // Forget bodies that are gone and done fading.
  const keep = new Set(nodes.map((n) => n.id));
  for (const id of s.bodies.keys()) if (!keep.has(id)) s.bodies.delete(id);

  // Runs the layout frame by frame while it settles, and while Claude works.
  const [, frame] = useState(0);
  const liveRef = useRef(live);
  liveRef.current = live;
  const runningRef = useRef(running);
  runningRef.current = running;
  // biome-ignore lint/correctness/useExhaustiveDependencies: restarts when the graph or room changes
  useEffect(() => {
    if (!room || reducedMotion()) return;
    let raf = 0;
    const tick = (time: number) => {
      const st = sim.current;
      st.t = time;
      const alive = runningRef.current;
      st.alpha = Math.max(st.alpha * 0.985, alive ? ALPHA_ALIVE : 0);
      step(liveRef.current, st.bodies, width, st.alpha, time, alive);
      frame((n) => (n + 1) % 1_000_000);
      if (alive || st.alpha > ALPHA_MIN) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [signature, room, running]);

  if (!room) return <div ref={wrap} className="w-full" style={{ height: 120 }} />;

  const size = new Map(nodes.map((n) => [n.id, n]));
  const height = Math.max(extent(nodes, s.bodies), MAIN_H + 16);
  const time = s.t || performance.now();

  return (
    <div ref={wrap} className="relative w-full" style={{ height: height * scale }}>
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{ width, height, transform: scale < 1 ? `scale(${scale})` : undefined }}
      >
        <svg
          width={width}
          height={height}
          className="absolute inset-0 overflow-visible"
          aria-hidden
        >
          {edges.map((e) => {
            const p = s.bodies.get(e.from);
            const c = s.bodies.get(e.to);
            const pn = size.get(e.from);
            const cn = size.get(e.to);
            if (!p || !c || !pn || !cn) return null;
            const g = geometry(p, pn, c, cn);
            return (
              <g key={e.id} className={e.leaving ? "anim-node-out" : "anim-node-in"}>
                <path
                  d={pathOf(g)}
                  fill="none"
                  style={{
                    stroke: e.active ? e.color : "var(--c-border-strong)",
                    strokeOpacity: e.active ? 0.6 : 0.9,
                    strokeWidth: e.active ? 1.6 : 1.2,
                    transition:
                      "stroke 0.4s ease, stroke-opacity 0.4s ease, stroke-width 0.4s ease",
                  }}
                  strokeDasharray={e.active ? undefined : "3 4"}
                />
                {e.active && !e.leaving && (
                  <g className="motion-reduce:hidden">
                    {[0, 1, 2].map((i) => {
                      const at = pointAt(g, (((time / 1500 + i / 3) % 1) + 1) % 1);
                      return (
                        <rect
                          key={i}
                          width={7}
                          height={3.5}
                          rx={1.5}
                          x={-3.5}
                          y={-1.75}
                          fill={e.color}
                          transform={`translate(${at.x} ${at.y}) rotate(${at.angle})`}
                        />
                      );
                    })}
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {nodes.map((n) => {
          const b = s.bodies.get(n.id);
          if (!b) return null;
          return (
            <div
              key={n.id}
              className="absolute"
              style={{ left: b.x - n.w / 2, top: b.y - n.h / 2, width: n.w, height: n.h }}
            >
              <div
                className={`h-full w-full ${n.leaving ? "anim-node-out" : n.kind === "main" ? "" : "anim-node-pop"}`}
              >
                {n.kind === "main" ? (
                  <MainNode
                    session={session}
                    more={graph.agents.length ? 0 : (graph.hidden.main ?? 0)}
                  />
                ) : n.kind === "head" ? (
                  n.agent ? (
                    <AgentCard agent={n.agent} hidden={n.hidden} />
                  ) : (
                    <OwnCard active={n.active} hidden={n.hidden} />
                  )
                ) : (
                  <ResourceChip
                    node={n.node}
                    label={n.node.kind === "ask" ? t("live.ask.what") : n.node.label}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MainNode({ session, more }: { session: Session; more: number }) {
  const t = useT();
  const state = useShownState(session);
  const blend = useBlend(state);
  const color = stateColor(state);
  return (
    <div
      className="flex h-full items-center gap-2.5 rounded-xl bg-surface-raised px-3 shadow-card"
      style={{
        ...blendStyle(blend),
        boxShadow: `inset 0 0 0 1px ${state === "idle" ? "var(--c-border)" : color}`,
      }}
    >
      <StatusOrb state={state} size={32} />
      <div className="min-w-0">
        <div className="text-sm font-semibold">Claude</div>
        <div className="truncate text-fs-11">
          <Blended text={t(stateLabel(state))} ms={blend} style={{ color }} />
          {more > 0 && (
            <span className="text-text-subtle"> · {t("live.graph.more", { n: more })}</span>
          )}
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
      className={`flex h-full items-center gap-2 rounded-lg bg-surface-raised px-2.5 ${agent.active ? "anim-glow" : ""}`}
      style={{
        ...blendStyle(400),
        ["--glow" as string]: color,
        boxShadow: agent.active ? undefined : "inset 0 0 0 1px var(--c-border)",
      }}
      title={agent.label}
    >
      <Bot
        size={15}
        className={`shrink-0 ${agent.active ? "anim-breathe" : ""}`}
        style={{ color: agent.active ? color : "var(--c-text-subtle)", transition: "color 0.4s" }}
      />
      <div className="min-w-0 flex-1">
        <div className={`truncate text-fs-12 font-medium ${agent.active ? "" : "text-text-muted"}`}>
          {agent.label || t("live.graph.agent")}
        </div>
        <div className="truncate text-fs-10.5 text-text-subtle">
          <Blended text={agent.active ? t("live.graph.working") : t("live.graph.done")} ms={400} />
          {agent.calls > 0 && (
            <>
              {" · "}
              <span key={agent.calls} className="anim-tick inline-block">
                {t("live.graph.calls", { n: agent.calls })}
              </span>
            </>
          )}
          {hidden > 0 && ` · ${t("live.graph.more", { n: hidden })}`}
        </div>
      </div>
      {!agent.active && <Check size={13} className="anim-node-pop shrink-0 text-text-subtle" />}
    </div>
  );
}

function OwnCard({ active, hidden }: { active: boolean; hidden: number }) {
  const t = useT();
  return (
    <div
      className={`flex h-full items-center gap-2 rounded-lg px-2.5 ${active ? "anim-glow" : ""}`}
      style={{
        ...blendStyle(400),
        ["--glow" as string]: "var(--c-accent)",
        boxShadow: active ? undefined : "inset 0 0 0 1px var(--c-border)",
      }}
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
      className={`flex h-full items-center gap-1.5 rounded-md bg-sunken px-2 text-fs-11 ${node.active ? "anim-glow" : ""}`}
      style={{ ...blendStyle(400), ["--glow" as string]: color }}
      title={node.title}
    >
      <Icon size={12} className="shrink-0" style={{ color, transition: "color 0.4s" }} />
      <span
        className={`min-w-0 flex-1 truncate ${node.active ? "text-text" : "text-text-muted"}`}
        style={{ transition: "color 0.4s" }}
      >
        {label}
      </span>
      {node.count > 1 && (
        <span key={node.count} className="anim-tick shrink-0 text-fs-10 text-text-subtle">
          ×{node.count}
        </span>
      )}
      {node.category === "edit" && (
        <span className="shrink-0 text-fs-10" style={{ color }}>
          {t("live.verb.edit")}
        </span>
      )}
    </div>
  );
}
