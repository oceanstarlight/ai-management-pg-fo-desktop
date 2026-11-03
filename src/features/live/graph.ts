import type { Category, Session, Step } from "../../store/activity";

/**
 * What the work graph draws for the current prompt: Claude, the subagents it
 * started, and what each of them works on (files, web, searches, MCP and
 * other tools; commands and plans are left to the timeline).
 */

export type ResourceKind = "file" | "web" | "search" | "mcp" | "ask" | "other";

export interface AgentNode {
  id: string;
  label: string;
  active: boolean;
  calls: number;
  at: number;
}

export interface ResourceNode {
  id: string;
  /** `main` or an agent's id. */
  parent: string;
  kind: ResourceKind;
  /** The colour: the last thing done to it. */
  category: Category;
  label: string;
  title: string;
  active: boolean;
  count: number;
  /** Last touched (ms). */
  at: number;
}

/** A module of Encela Hub (adaptive tools) Claude opened or used this turn. */
export interface ModuleNode {
  /** `mod:<name>`, the parent of its resources. */
  id: string;
  name: string;
  /** The combination it was opened with, if any. */
  combo: string;
  active: boolean;
  calls: number;
  at: number;
}

export interface Graph {
  /** The prompt's start, or null before the first one. */
  turnAt: number | null;
  prompt: string;
  running: boolean;
  agents: AgentNode[];
  modules: ModuleNode[];
  resources: ResourceNode[];
  /** Resources not drawn, per parent. */
  hidden: Record<string, number>;
}

/** Drawn per parent at most (the working ones first, then the latest). */
export const PER_PARENT = 4;
/** Drawn under Claude itself when it has no subagents. */
export const MAIN_ALONE = 6;
/** A finished resource stays this long while the prompt runs, then gives way. */
export const LINGER_MS = 7000;

const base = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

function host(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function resourceOf(step: Step): { kind: ResourceKind; key: string; label: string } | null {
  const c = step.category;
  if (c === "read" || c === "edit") {
    if (!step.target) return null;
    return { kind: "file", key: step.target, label: base(step.target) };
  }
  if (c === "web") {
    const what = step.detail || step.tool;
    const label = step.tool === "WebFetch" ? host(what) : what;
    return { kind: "web", key: `${step.tool}:${what}`, label };
  }
  if (c === "search") {
    const what = step.detail || step.target || step.tool;
    return { kind: "search", key: `${step.tool}:${what}`, label: what };
  }
  if (c === "mcp") {
    const what = step.detail || step.tool;
    return { kind: "mcp", key: what, label: what };
  }
  if (c === "ask") return { kind: "ask", key: step.id || "ask", label: "" };
  if (c === "other" || c === "") return { kind: "other", key: step.tool, label: step.tool };
  // run, plan and agent are not drawn as resources.
  return null;
}

const HUB = "mcp__encela-hub__";

/**
 * What an Encela Hub tool call is about: the module(s) and, for a tool of a
 * module, the tool's own name. Listing calls are about no module.
 */
export function hubCall(
  step: Pick<Step, "tool" | "target">,
  combos: Record<string, string[]>,
): { modules: string[]; tool: string; combo: string } | null {
  if (!step.tool.startsWith(HUB)) return null;
  const rest = step.tool.slice(HUB.length);
  if (rest === "hub_open_combo") {
    return { modules: combos[step.target] ?? [], tool: "", combo: step.target };
  }
  if (rest === "hub_open_server" || rest === "hub_close_server" || rest === "hub_list_tools") {
    return step.target ? { modules: [step.target], tool: "", combo: "" } : null;
  }
  if (rest === "hub_call") {
    return step.target ? { modules: [step.target], tool: "hub_call", combo: "" } : null;
  }
  if (rest.startsWith("hub_")) return null;
  const at = rest.indexOf("__");
  if (at <= 0) return null;
  return { modules: [rest.slice(0, at)], tool: rest.slice(at + 2), combo: "" };
}

/**
 * Builds the graph of the session's current (or last) prompt at `now`.
 * `combos` (Encela Hub combination → its modules) shows what opening one starts.
 */
export function buildGraph(
  session: Session,
  now: number,
  combos: Record<string, string[]> = {},
): Graph {
  const steps = session.steps;
  let start = -1;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s?.kind === "turn" && s.phase === "start" && !s.agent) {
      start = i;
      break;
    }
  }
  const turn = start >= 0 ? steps[start] : undefined;
  const tail = start >= 0 ? steps.slice(start + 1) : steps;
  const running = session.state !== "idle" && session.state !== "ended";

  const ended = new Set<string>();
  for (const s of tail) if (s.kind === "toolEnd") ended.add(s.id);

  // Claude's Agent calls, in order, and the subagents that ran.
  const calls = tail.filter((s) => s.kind === "tool" && !s.agent && s.category === "agent");
  const seen: string[] = [];
  const firstText = new Map<string, string>();
  for (const s of tail) {
    if (!s.agent) continue;
    if (!seen.includes(s.agent)) seen.push(s.agent);
    if (s.kind === "turn" && s.phase === "start" && !firstText.has(s.agent))
      firstText.set(s.agent, s.detail);
  }
  // A subagent's first turn starts with its task; otherwise the calls go in order.
  const callOf = new Map<string, Step>();
  const used = new Set<string>();
  for (const id of seen) {
    const text = firstText.get(id);
    const match = text
      ? calls.find(
          (c) => !used.has(c.id) && c.prompt && (c.prompt === text || text.startsWith(c.prompt)),
        )
      : undefined;
    if (match) {
      callOf.set(id, match);
      used.add(match.id);
    }
  }
  for (const id of seen) {
    if (callOf.has(id)) continue;
    const next = calls.find((c) => !used.has(c.id));
    if (next) {
      callOf.set(id, next);
      used.add(next.id);
    }
  }

  const agents: AgentNode[] = [];
  for (const id of seen) {
    const call = callOf.get(id);
    const own = tail.filter((s) => s.agent === id && s.kind === "tool");
    const open = own.some((s) => !ended.has(s.id));
    agents.push({
      id,
      label: call?.detail || "",
      active: running && (call ? !ended.has(call.id) : open),
      calls: own.length,
      at: call?.at ?? own[0]?.at ?? 0,
    });
  }
  // Calls whose subagent has not reported yet still show (starting).
  for (const call of calls) {
    if (used.has(call.id)) continue;
    agents.push({
      id: `call:${call.id}`,
      label: call.detail,
      active: running && !ended.has(call.id),
      calls: 0,
      at: call.at,
    });
  }
  agents.sort((a, b) => a.at - b.at);

  // Encela Hub modules: opened, or their tools called.
  const mods = new Map<string, ModuleNode>();
  const hubOf = new Map<string, ReturnType<typeof hubCall>>();
  for (const s of tail) {
    if (s.kind !== "tool") continue;
    const h = hubCall(s, combos);
    if (!h) continue;
    hubOf.set(s.id, h);
    for (const name of h.modules) {
      const id = `mod:${name}`;
      const prev = mods.get(id);
      const active = running && !ended.has(s.id);
      mods.set(id, {
        id,
        name,
        combo: h.combo || prev?.combo || "",
        active: (prev?.active ?? false) || active,
        calls: (prev?.calls ?? 0) + (h.tool ? 1 : 0),
        at: prev?.at ?? s.at,
      });
    }
  }
  const modules = [...mods.values()].sort((a, b) => a.at - b.at);

  // What each one works on, merged by target.
  const byKey = new Map<string, ResourceNode>();
  for (const s of tail) {
    if (s.kind !== "tool") continue;
    const h = hubOf.get(s.id);
    // Opening or closing a module draws the module itself, and listing what
    // the hub has draws nothing.
    if ((h && !h.tool) || (!h && s.tool.startsWith(HUB))) continue;
    const r = h ? { kind: "mcp" as ResourceKind, key: h.tool, label: h.tool } : resourceOf(s);
    if (!r) continue;
    const parent = h ? `mod:${h.modules[0]}` : (s.agent ?? "main");
    const id = `${parent}|${r.kind}|${r.key}`;
    const active = running && !ended.has(s.id);
    const prev = byKey.get(id);
    byKey.set(id, {
      id,
      parent,
      kind: r.kind,
      category: (prev?.category === "edit" && s.category === "read"
        ? "edit"
        : s.category || "other") as Category,
      label: r.label,
      title: [s.tool, s.target, s.detail].filter(Boolean).join("  "),
      active: (prev?.active ?? false) || active,
      count: (prev?.count ?? 0) + 1,
      at: Math.max(prev?.at ?? 0, s.at),
    });
  }

  // Working ones always; finished ones for a while (all of them once it stops).
  const resources: ResourceNode[] = [];
  const hidden: Record<string, number> = {};
  const parents = new Set([...byKey.values()].map((r) => r.parent));
  for (const parent of parents) {
    const mine = [...byKey.values()]
      .filter((r) => r.parent === parent)
      .sort((a, b) => Number(b.active) - Number(a.active) || b.at - a.at);
    const cap =
      parent === "main" && agents.length === 0 && modules.length === 0 ? MAIN_ALONE : PER_PARENT;
    const keep = mine.filter(
      (r, i) => r.active || (i < cap && (!running || now - r.at < LINGER_MS)),
    );
    const drawn = keep.slice(0, Math.max(cap, keep.filter((r) => r.active).length));
    resources.push(...drawn);
    if (mine.length > drawn.length) hidden[parent] = mine.length - drawn.length;
  }

  return {
    turnAt: turn?.at ?? null,
    prompt: turn?.detail ?? "",
    running,
    agents,
    modules,
    resources: resources.sort((a, b) => a.at - b.at),
    hidden,
  };
}
