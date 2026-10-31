// Squarified treemap layout (Bruls, Huizing and van Wijk): lays weighted
// items out in a rectangle in rows that keep cells close to square.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placed<T> extends Rect {
  item: T;
}

function worst(row: number[], side: number): number {
  const sum = row.reduce((a, b) => a + b, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  const s2 = side * side;
  const sum2 = sum * sum;
  return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
}

/** Places `items` (weights > 0) in `rect`, biggest first. */
export function squarify<T>(items: { item: T; weight: number }[], rect: Rect): Placed<T>[] {
  const total = items.reduce((a, b) => a + b.weight, 0);
  if (!items.length || total <= 0 || rect.w <= 0 || rect.h <= 0) return [];
  const scale = (rect.w * rect.h) / total;
  const sorted = [...items]
    .filter((i) => i.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .map((i) => ({ item: i.item, area: i.weight * scale }));
  const out: Placed<T>[] = [];
  let { x, y, w, h } = rect;
  let row: typeof sorted = [];

  const layRow = () => {
    const sum = row.reduce((a, b) => a + b.area, 0);
    if (w >= h) {
      // A column on the left.
      const cw = sum / h;
      let cy = y;
      for (const r of row) {
        const ch = r.area / cw;
        out.push({ item: r.item, x, y: cy, w: cw, h: ch });
        cy += ch;
      }
      x += cw;
      w -= cw;
    } else {
      // A row on top.
      const rh = sum / w;
      let cx = x;
      for (const r of row) {
        const cw = r.area / rh;
        out.push({ item: r.item, x: cx, y, w: cw, h: rh });
        cx += cw;
      }
      y += rh;
      h -= rh;
    }
    row = [];
  };

  for (const next of sorted) {
    const side = Math.min(w, h);
    const areas = row.map((r) => r.area);
    if (!row.length || worst([...areas, next.area], side) <= worst(areas, side)) {
      row.push(next);
    } else {
      layRow();
      row.push(next);
    }
  }
  if (row.length) layRow();
  return out;
}

/** The folder a file is grouped under on the map: its first path part. */
export function groupOf(path: string): string {
  const i = path.indexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}
