/**
 * A small force layout for the work graph: Claude, its subagents and what
 * they work on find their own places. Children hang below their parent on
 * springs, everything pushes its neighbours away and never overlaps, and a
 * new node springs out of its parent. No library: the graph is small.
 */

export interface SimNode {
  id: string;
  w: number;
  h: number;
  /** The parent's id; `null` for Claude itself. */
  parent: string | null;
  /** 0: Claude, 1: a subagent (or Claude's own work), 2: what one works on. */
  depth: number;
}

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Spring length (centre to centre) from a parent, by the child's depth. */
const LINK = [0, 112, 70];
/** Room kept between two boxes. */
const PAD = 10;
/** How far Claude leans off the middle toward its work (px). */
export const LEAN = 36;
/** Below this the layout is still. */
export const ALPHA_MIN = 0.004;
/** While Claude works the graph keeps drifting a little. */
export const ALPHA_ALIVE = 0.06;

const hash = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (h % 1000) / 1000;
};

/** Where a new node starts: just under its parent, beside its siblings. */
export function seed(
  node: SimNode,
  bodies: Map<string, Body>,
  siblings: number,
  index: number,
  width: number,
): Body {
  const parent = node.parent ? bodies.get(node.parent) : undefined;
  if (!parent) return { x: width / 2, y: node.h / 2 + 6, vx: 0, vy: 0 };
  const spread = node.w + PAD;
  return {
    x: parent.x + (index - (siblings - 1) / 2) * spread * 0.6,
    y: parent.y + (LINK[node.depth] ?? 66) * 0.5,
    vx: 0,
    vy: 2,
  };
}

/**
 * One step of the layout. `t` (ms) sways the springs a little while `alive`,
 * so a working graph never looks frozen.
 */
export function step(
  nodes: SimNode[],
  bodies: Map<string, Body>,
  width: number,
  alpha: number,
  t: number,
  alive: boolean,
) {
  const list = nodes
    .map((n) => [n, bodies.get(n.id)] as const)
    .filter((e): e is readonly [SimNode, Body] => !!e[1]);
  const children = new Map<string, Body[]>();
  for (const [n, b] of list) {
    if (!n.parent) continue;
    const arr = children.get(n.parent) ?? [];
    arr.push(b);
    children.set(n.parent, arr);
  }

  for (const [n, b] of list) {
    // Claude stays near the top, leaning toward where its work is.
    if (!n.parent) {
      const kids = children.get(n.id) ?? [];
      const mean = kids.length ? kids.reduce((s, k) => s + k.x, 0) / kids.length : width / 2;
      // Only a little, so the corners beside it stay free.
      const lean = Math.max(-LEAN, Math.min(LEAN, (mean - width / 2) * 0.35));
      b.vx += (width / 2 + lean - b.x) * 0.05 * alpha;
      b.vy += (n.h / 2 + 6 - b.y) * 0.12 * alpha;
      continue;
    }
    const p = bodies.get(n.parent);
    if (!p) continue;
    const sway = alive ? 1 + 0.06 * Math.sin(t / 1700 + hash(n.id) * Math.PI * 2) : 1;
    const len = (LINK[n.depth] ?? 66) * sway;
    const dx = b.x - p.x;
    const dy = b.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const k = ((d - len) / d) * 0.09 * alpha;
    b.vx -= dx * k;
    b.vy -= dy * k;
    if (n.depth > 1) {
      p.vx += dx * k * 0.12;
      p.vy += dy * k * 0.12;
    }
    // Children hang below their parent.
    const below = len * 0.75;
    if (dy < below) b.vy += (below - dy) * 0.3 * alpha;
    // A slight pull to the middle keeps the whole graph together.
    b.vx += (width / 2 - b.x) * 0.003 * alpha;
  }

  // Neighbours push each other apart (stronger when close).
  for (const [i, [na, a]] of list.entries()) {
    for (const [nb, b] of list.slice(i + 1)) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 300 * 300) continue;
      const d = Math.sqrt(d2) || 1;
      const f = (900 / Math.max(d2, 400)) * alpha;
      const ux = dx / d;
      const uy = dy / d;
      const wa = na.parent ? 1 : 0.15;
      const wb = nb.parent ? 1 : 0.15;
      // Nodes of one level spread sideways rather than piling up.
      const level = na.depth === nb.depth;
      const fx = level ? 2.6 : 1;
      const fy = level ? 0.2 : 0.5;
      const sx = level && Math.abs(dx) < 1 ? (hash(nb.id) > hash(na.id) ? 1 : -1) : ux;
      a.vx -= sx * f * wa * fx;
      a.vy -= uy * f * wa * fy;
      b.vx += sx * f * wb * fx;
      b.vy += uy * f * wb * fy;
    }
  }

  for (const [n, b] of list) {
    b.vx *= 0.62;
    b.vy *= 0.62;
    b.x += b.vx;
    b.y += b.vy;
    b.x = Math.min(Math.max(b.x, n.w / 2 + 2), Math.max(width - n.w / 2 - 2, n.w / 2 + 2));
    b.y = Math.max(b.y, n.h / 2 + 2);
  }

  // Boxes never overlap: the smaller overlap is pushed apart at once.
  for (let pass = 0; pass < 2; pass++) {
    for (const [i, [na, a]] of list.entries()) {
      for (const [nb, b] of list.slice(i + 1)) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const ox = (na.w + nb.w) / 2 + PAD - Math.abs(dx);
        const oy = (na.h + nb.h) / 2 + PAD - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        const wa = na.parent ? 0.5 : 0.05;
        const wb = nb.parent ? 0.5 : 0.05;
        const sum = wa + wb;
        // One level side by side, unless they barely overlap in height.
        const sideways = na.depth === nb.depth ? oy > ox * 0.4 : ox < oy;
        if (sideways) {
          const s = dx === 0 ? (hash(nb.id) > hash(na.id) ? 1 : -1) : Math.sign(dx);
          a.x -= (s * ox * wa) / sum;
          b.x += (s * ox * wb) / sum;
        } else {
          const s = dy === 0 ? 1 : Math.sign(dy);
          a.y -= (s * oy * wa) / sum;
          b.y += (s * oy * wb) / sum;
        }
      }
    }
  }
  for (const [n, b] of list) {
    b.x = Math.min(Math.max(b.x, n.w / 2 + 2), Math.max(width - n.w / 2 - 2, n.w / 2 + 2));
    b.y = Math.max(b.y, n.h / 2 + 2);
  }
}

/** The height the laid-out nodes need. */
export function extent(nodes: SimNode[], bodies: Map<string, Body>): number {
  let bottom = 0;
  for (const n of nodes) {
    const b = bodies.get(n.id);
    if (b) bottom = Math.max(bottom, b.y + n.h / 2);
  }
  return bottom + 10;
}
