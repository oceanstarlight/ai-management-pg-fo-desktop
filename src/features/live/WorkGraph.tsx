import {
  Blocks,
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
import { type MessageKey, useT } from "../../i18n";
import { type Category, type Session, turnsOf } from "../../store/activity";
import { useHubStore } from "../../store/hub";
import { ALPHA_ALIVE, ALPHA_MIN, type Body, reach, type SimNode, seed, step } from "./forceLayout";
import {
  type AgentNode,
  buildGraph,
  type ModuleNode,
  type ResourceKind,
  type ResourceNode,
} from "./graph";
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
/** An Encela Hub module: as big as Claude, an orchestrator of its own work. */
const MODULE_W = 196;
const MODULE_H = 56;
const RES_W = 138;
const RES_H = 30;
/** Narrower than this and the graph lays out as if it had this much room. */
const MIN_W = 360;
/** The graph's own fixed height, so what is below it never moves (px). */
const FRAME_H = 400;
/** Of the frame, the line above the graph (this request, the colours) (px). */
const STRIP_H = 44;
/** A tall graph shrinks to fit the frame, down to this; past it the frame scrolls. */
const FIT_MIN = 0.7;
/** The line above the graph (this request, the colours) needs this much room (px). */
const STRIP_MIN = 300;
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
    | { kind: "module"; module: ModuleNode; hidden: number }
    | { kind: "res"; node: ResourceNode }
  );

interface Edge {
  id: string;
  from: string;
  to: string;
  color: string;
  active: boolean;
}

/** Claude, its subagents and modules (and its own work when it has some), and what each works on. */
function nodesOf(
  agents: AgentNode[],
  modules: ModuleNode[],
  resources: ResourceNode[],
  hidden: Record<string, number>,
): { nodes: GraphNode[]; edges: Edge[] } {
  const nodes: GraphNode[] = [
    { id: "main", kind: "main", w: MAIN_W, h: MAIN_H, parent: null, depth: 0 },
  ];
  const edges: Edge[] = [];
  const own = resources.filter((r) => r.parent === "main");

  if (agents.length === 0 && modules.length === 0) {
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
  for (const module of modules) {
    const id = `h:${module.id}`;
    nodes.push({
      id,
      kind: "module",
      module,
      hidden: hidden[module.id] ?? 0,
      w: MODULE_W,
      h: MODULE_H,
      parent: "main",
      depth: 1,
    });
    edges.push({
      id: `e:${id}`,
      from: "main",
      to: id,
      color: stateColor("mcp"),
      active: module.active,
    });
    for (const node of resources.filter((r) => r.parent === module.id)) {
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
 * A soft curve from parent to child: bottom to top when the child is below,
 * top to bottom when it is above, side to side while it sits beside.
 */
function geometry(p: Body, pn: SimNode, c: Body, cn: SimNode): Geo {
  const below = c.y - cn.h / 2 >= p.y + pn.h / 2 - 4;
  const above = c.y + cn.h / 2 <= p.y - pn.h / 2 + 4;
  // Far to the side, a side-to-side line reads better even when it also climbs.
  const side = Math.abs(c.x - p.x) - (pn.w + cn.w) / 2 > Math.abs(c.y - p.y) * 0.6;
  if ((below || above) && !side) {
    const dir = below ? 1 : -1;
    const y0 = p.y + (dir * pn.h) / 2;
    const y3 = c.y - (dir * cn.h) / 2;
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
 * Claude's whole work for the current prompt: Claude in the middle, the
 * subagents it started around it, and what each one reads, edits, looks up
 * or calls further out. Every node finds its own place (a small force
 * layout), springs out of its parent when it appears and drifts gently while
 * Claude works; lines with something moving along them are working now.
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

  // Opening an Encela Hub combination starts its modules.
  const hubCombos = useHubStore((s) => s.combos);
  useEffect(() => {
    if (!useHubStore.getState().loaded) void useHubStore.getState().load();
  }, []);
  const combos = useMemo(
    () => Object.fromEntries(hubCombos.map((c) => [c.name, c.members.map((m) => m.module)])),
    [hubCombos],
  );
  const graph = useMemo(() => buildGraph(session, now, combos), [session, now, combos]);
  const { nodes: current, edges: currentEdges } = useMemo(
    () => nodesOf(graph.agents, graph.modules, graph.resources, graph.hidden),
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
    for (const n of live) {
      if (s.bodies.has(n.id)) continue;
      s.bodies.set(n.id, seed(n, s.bodies, width));
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

  if (!room) return <div ref={wrap} className="w-full" style={{ height: FRAME_H }} />;

  const size = new Map(nodes.map((n) => [n.id, n]));
  // Claude stays in the middle: as much room above it as below. In steps, so
  // the drift does not keep resizing the view.
  const half = Math.ceil(Math.max(reach(nodes, s.bodies), MAIN_H / 2 + 8) / 24) * 24;
  const height = 2 * half;
  const time = s.t || performance.now();
  const strip = room >= STRIP_MIN;
  const view = strip ? FRAME_H - STRIP_H : FRAME_H;
  // A fixed view: the graph shrinks a little to fit, and scrolls past that.
  const fit = height * scale > view ? Math.max(FIT_MIN, view / (height * scale)) : 1;
  const zoom = scale * fit;
  const left = (room - width * zoom) / 2;
  const top = Math.max(0, (view - height * zoom) / 2);
  // The layout puts Claude at y = 0; the view at the middle of its height.
  const bodyOf = (id: string): Body | undefined => {
    const b = s.bodies.get(id);
    return b && { ...b, y: b.y + half };
  };

  return (
    <div ref={wrap} className="w-full" style={{ height: FRAME_H }}>
      {strip && (
        <div className="flex items-start justify-between gap-6" style={{ height: STRIP_H }}>
          <RequestLine session={session} />
          <Legend graph={graph} />
        </div>
      )}
      <div
        className={`relative w-full ${height * zoom > view ? "overflow-y-auto" : "overflow-hidden"}`}
        style={{ height: view }}
      >
        <div style={{ height: height * zoom }} aria-hidden />
        <div
          className="absolute origin-top-left"
          style={{
            left,
            top,
            width,
            height,
            transform: zoom < 1 ? `scale(${zoom})` : undefined,
            transition: "transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), left 0.5s, top 0.5s",
          }}
        >
          <svg
            width={width}
            height={height}
            className="absolute inset-0 overflow-visible"
            aria-hidden
          >
            {edges.map((e) => {
              const p = bodyOf(e.from);
              const c = bodyOf(e.to);
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
            const b = bodyOf(n.id);
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
                      more={
                        graph.agents.length || graph.modules.length ? 0 : (graph.hidden.main ?? 0)
                      }
                    />
                  ) : n.kind === "module" ? (
                    <ModuleCard module={n.module} hidden={n.hidden} />
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
    </div>
  );
}

/** Above the graph, on the left: what this turn was asked to do. */
function RequestLine({ session }: { session: Session }) {
  const t = useT();
  const prompt = useMemo(() => {
    const turns = turnsOf(session.steps);
    return turns[turns.length - 1]?.prompt.trim() ?? "";
  }, [session.steps]);
  if (!prompt) return null;
  return (
    <div className="min-w-0 flex-1" title={prompt}>
      <div className="text-fs-10.5 font-medium text-text-subtle">{t("live.graph.request")}</div>
      <p
        key={prompt}
        className="anim-blend-in selectable mt-0.5 line-clamp-2 text-fs-12 text-text-muted"
      >
        {prompt}
      </p>
    </div>
  );
}

/** Above the graph, on the right: what each colour on the graph means (only those on it). */
function Legend({ graph }: { graph: ReturnType<typeof buildGraph> }) {
  const t = useT();
  const counts = new Map<Category, number>();
  if (graph.agents.length) counts.set("agent", graph.agents.length);
  if (graph.modules.length) counts.set("mcp", graph.modules.length);
  for (const r of graph.resources) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  if (!counts.size) return null;
  return (
    <div className="max-w-[55%] shrink-0 text-right">
      <div className="text-fs-10.5 font-medium text-text-subtle">{t("live.graph.legend")}</div>
      <ul className="mt-1 flex max-h-10 flex-wrap justify-end gap-x-3 gap-y-1 overflow-hidden text-fs-11 text-text-muted">
        {[...counts].map(([cat, n]) => (
          <li key={cat} className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full" style={{ background: stateColor(cat) }} />
            {t(`live.verb.${cat}` as MessageKey)}
            <span
              key={n}
              className="anim-tick inline-block font-mono tabular-nums text-text-subtle"
            >
              {n}
            </span>
          </li>
        ))}
      </ul>
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

/** An Encela Hub module Claude opened: drawn like Claude, it runs its own tools. */
function ModuleCard({ module: m, hidden }: { module: ModuleNode; hidden: number }) {
  const t = useT();
  const color = stateColor("mcp");
  return (
    <div
      className={`flex h-full items-center gap-2.5 rounded-xl bg-surface-raised px-3 shadow-card ${m.active ? "anim-glow" : ""}`}
      style={{
        ...blendStyle(400),
        ["--glow" as string]: color,
        boxShadow: `inset 0 0 0 ${m.active ? 1.5 : 1}px ${m.active ? color : "var(--c-border-strong)"}`,
      }}
      title={m.combo ? t("live.graph.moduleOf", { combo: m.combo }) : t("live.graph.module")}
    >
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full"
        style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}
      >
        <Blocks size={16} className={m.active ? "anim-breathe" : ""} style={{ color }} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{m.name}</div>
        <div className="truncate text-fs-11 text-text-subtle">
          <Blended
            text={m.active ? t("live.graph.working") : t("live.graph.module")}
            ms={400}
            style={m.active ? { color } : undefined}
          />
          {m.calls > 0 && (
            <>
              {" · "}
              <span key={m.calls} className="anim-tick inline-block">
                {t("live.graph.calls", { n: m.calls })}
              </span>
            </>
          )}
          {m.combo && ` · ${m.combo}`}
          {hidden > 0 && ` · ${t("live.graph.more", { n: hidden })}`}
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
