/**
 * A small force layout for the work graph: Claude sits in the middle, its
 * subagents (or what it works on itself) ring around it, and what each of
 * them works on fans out further along the same direction. Every node is
 * pulled toward its place on the rings, everything pushes its neighbours
 * away and never overlaps, and a new node springs out of its parent. No
 * library: the graph is small.
 *
 * Coordinates: Claude is at (width / 2, 0); y grows downward and may be
 * negative (the view centres the graph on Claude).
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

/** Room kept between two boxes. */
const PAD = 10;
/** The inner ring's height (centre to centre, px). */
const RING_Y = 90;
/** How much further out the outer ring is than the inner one (px). */
const RING_STEP_Y = 60;
/** Room kept between Claude and the inner ring, and between the rings, sideways (px). */
const GAP_X = 26;
/** Below this the layout is still. */
export const ALPHA_MIN = 0.004;
/** While Claude works the graph keeps drifting a little. */
export const ALPHA_ALIVE = 0.06;

const hash = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1000) / 1000;
};

/**
 * The direction of each of `n` nodes around Claude (radians, 0 = right,
 * clockwise on screen). Two sit left and right; four take the corners.
 */
function angleOf(i: number, n: number): number {
  const offset = n % 2 === 0 && n > 2 ? Math.PI / n : 0;
  return Math.PI + (2 * Math.PI * i) / n + offset;
}

interface Rings {
  rx1: number;
  ry1: number;
  rx2: number;
  ry2: number;
}

/** The rings' sizes for the room there is and the boxes on them. */
function ringsOf(nodes: SimNode[], width: number): Rings {
  const root = nodes.find((n) => !n.parent);
  const rootW = root?.w ?? 0;
  let w1 = 0;
  let w2 = 0;
  for (const n of nodes) {
    if (n.depth === 1) w1 = Math.max(w1, n.w);
    if (n.depth === 2) w2 = Math.max(w2, n.w);
  }
  const half = width / 2;
  const minX1 = rootW / 2 + w1 / 2 + GAP_X;
  if (!w2) {
    const rx1 = Math.max(Math.min(half - w1 / 2 - 4, minX1 + 90), minX1);
    return { rx1, ry1: RING_Y * 0.85, rx2: rx1, ry2: RING_Y * 0.85 };
  }
  // The inner ring clears Claude also on the diagonals; the outer one uses the width.
  const rx2 = Math.max(half - w2 / 2 - 4, minX1 + 100);
  const rx1 = Math.max(minX1 + 40, Math.min(rx2 * 0.62, rx2 - 60));
  return { rx1, ry1: RING_Y, rx2, ry2: RING_Y + RING_STEP_Y };
}

/**
 * Where each node wants to be. `t` (ms) sways the rings a little while
 * `alive`, so a working graph never looks frozen.
 */
function targets(
  nodes: SimNode[],
  width: number,
  t: number,
  alive: boolean,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const root = nodes.find((n) => !n.parent);
  if (!root) return out;
  const cx = width / 2;
  out.set(root.id, { x: cx, y: 0 });
  const rings = ringsOf(nodes, width);
  const sway = (id: string) =>
    alive ? 1 + 0.035 * Math.sin(t / 1700 + hash(id) * Math.PI * 2) : 1;

  const ring = nodes.filter((n) => n.parent === root.id);
  const angle = new Map<string, number>();
  for (const [i, n] of ring.entries()) {
    const a = angleOf(i, ring.length);
    angle.set(n.id, a);
    const s = sway(n.id);
    out.set(n.id, { x: cx + rings.rx1 * s * Math.cos(a), y: rings.ry1 * s * Math.sin(a) });
  }

  const kids = new Map<string, SimNode[]>();
  for (const n of nodes) {
    if (!n.parent || n.parent === root.id) continue;
    kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  }
  const sector = (2 * Math.PI) / Math.max(ring.length, 1);
  for (const [parent, list] of kids) {
    const base = angle.get(parent);
    if (base === undefined) continue;
    const k = list.length;
    const spread = Math.min(sector * 0.75, (k - 1) * 0.7);
    for (const [j, n] of list.entries()) {
      // A lone one sits a little off its parent's line, so it clears the parent.
      const a = k > 1 ? base + (j / (k - 1) - 0.5) * spread : base + 0.35;
      const r = sway(n.id);
      out.set(n.id, { x: cx + rings.rx2 * r * Math.cos(a), y: rings.ry2 * r * Math.sin(a) });
    }
  }
  return out;
}

/** Where a new node starts: on its parent, a little toward its place. */
export function seed(node: SimNode, bodies: Map<string, Body>, width: number): Body {
  const parent = node.parent ? bodies.get(node.parent) : undefined;
  if (!parent) return { x: width / 2, y: 0, vx: 0, vy: 0 };
  return { x: parent.x, y: parent.y, vx: 0, vy: 0 };
}

const clampX = (b: Body, n: SimNode, width: number) => {
  b.x = Math.min(Math.max(b.x, n.w / 2 + 2), Math.max(width - n.w / 2 - 2, n.w / 2 + 2));
};

/** One step of the layout. */
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
  const goal = targets(nodes, width, t, alive);

  // Each one is pulled toward its place; Claude stays put.
  for (const [n, b] of list) {
    const g = goal.get(n.id);
    if (!g) continue;
    if (!n.parent) {
      b.x = g.x;
      b.y = g.y;
      b.vx = 0;
      b.vy = 0;
      continue;
    }
    // A new node first springs out quickly, then settles.
    const k = 0.11 * Math.max(alpha, 0.04);
    b.vx += (g.x - b.x) * k;
    b.vy += (g.y - b.y) * k;
  }

  // Neighbours push each other apart (stronger when close).
  for (const [i, [na, a]] of list.entries()) {
    for (const [nb, b] of list.slice(i + 1)) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 220 * 220) continue;
      const d = Math.sqrt(d2) || 1;
      const f = (700 / Math.max(d2, 400)) * alpha;
      const sx = Math.abs(dx) < 1 ? (hash(nb.id) > hash(na.id) ? 1 : -1) : dx / d;
      const sy = dy / d;
      const wa = na.parent ? 1 : 0;
      const wb = nb.parent ? 1 : 0;
      a.vx -= sx * f * wa;
      a.vy -= sy * f * wa;
      b.vx += sx * f * wb;
      b.vy += sy * f * wb;
    }
  }

  for (const [n, b] of list) {
    if (!n.parent) continue;
    b.vx *= 0.62;
    b.vy *= 0.62;
    b.x += b.vx;
    b.y += b.vy;
    clampX(b, n, width);
  }

  // Boxes never overlap: the smaller overlap is pushed apart at once.
  for (let pass = 0; pass < 3; pass++) {
    for (const [i, [na, a]] of list.entries()) {
      for (const [nb, b] of list.slice(i + 1)) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const ox = (na.w + nb.w) / 2 + PAD - Math.abs(dx);
        const oy = (na.h + nb.h) / 2 + PAD - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        const wa = na.parent ? 0.5 : 0;
        const wb = nb.parent ? 0.5 : 0;
        const sum = wa + wb || 1;
        if (ox < oy) {
          const s = dx === 0 ? (hash(nb.id) > hash(na.id) ? 1 : -1) : Math.sign(dx);
          a.x -= (s * ox * wa) / sum;
          b.x += (s * ox * wb) / sum;
        } else {
          const s = dy === 0 ? (hash(nb.id) > hash(na.id) ? 1 : -1) : Math.sign(dy);
          a.y -= (s * oy * wa) / sum;
          b.y += (s * oy * wb) / sum;
        }
      }
    }
  }
  for (const [n, b] of list) if (n.parent) clampX(b, n, width);
}

/**
 * How far the laid-out nodes reach above and below Claude (px, the larger
 * of the two), so the view can keep Claude in the middle.
 */
export function reach(nodes: SimNode[], bodies: Map<string, Body>): number {
  let r = 0;
  for (const n of nodes) {
    const b = bodies.get(n.id);
    if (b) r = Math.max(r, Math.abs(b.y) + n.h / 2);
  }
  return r + 8;
}
