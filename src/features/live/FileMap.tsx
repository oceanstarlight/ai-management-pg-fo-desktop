import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import type { FileStat, Session } from "../../store/activity";
import { groupOf, type Placed, squarify } from "./treemap";

/** Cells drawn at most; touched files always make it in. */
const MAX_CELLS = 1500;
const LABEL_H = 14;
const GAP = 2;

type Cell = { path: string; stat: FileStat | undefined };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function fill(stat: FileStat | undefined): { color: string; opacity: number } {
  if (!stat) return { color: "var(--c-grid)", opacity: 1 };
  if (stat.edits > 0) {
    return { color: "var(--c-act-edit)", opacity: Math.min(1, 0.5 + stat.edits * 0.12) };
  }
  return { color: "var(--c-act-read)", opacity: Math.min(0.75, 0.3 + stat.reads * 0.1) };
}

/**
 * The project as a map of its files, grouped by top folder: what Claude read
 * glows cool, what it edited glows warm, and a marker sits on the file it is
 * working on now.
 */
export function FileMap({
  files,
  session,
  height = 300,
}: {
  files: string[];
  session: Session | null;
  height?: number;
}) {
  const t = useT();
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<string | null>(null);
  const stats = session?.files ?? {};
  const busy = !!session && session.state !== "idle" && session.state !== "ended";
  const marked = busy ? session?.doing || null : null;

  const cells = useMemo(() => {
    const touched = Object.keys(stats);
    const all = Array.from(new Set([...touched, ...files])).filter((p) => !p.startsWith("/"));
    const list = all.length > MAX_CELLS ? all.slice(0, MAX_CELLS) : all;
    const groups = new Map<string, Cell[]>();
    for (const path of list) {
      const g = groupOf(path);
      const cells = groups.get(g) ?? [];
      cells.push({ path, stat: stats[path] });
      groups.set(g, cells);
    }
    return { groups, total: all.length, shown: list.length };
  }, [files, stats]);

  const layout = useMemo(() => {
    if (width <= 0) return [] as { group: Placed<string>; files: Placed<Cell>[] }[];
    const groups = squarify(
      [...cells.groups.entries()].map(([g, list]) => ({ item: g, weight: list.length })),
      { x: 0, y: 0, w: width, h: height },
    );
    return groups.map((group) => {
      const labelled = group.h > 36 && group.w > 56;
      const inner = {
        x: group.x + GAP,
        y: group.y + (labelled ? LABEL_H : GAP),
        w: Math.max(0, group.w - GAP * 2),
        h: Math.max(0, group.h - (labelled ? LABEL_H : GAP) - GAP),
      };
      const list = cells.groups.get(group.item) ?? [];
      return {
        group,
        files: squarify(
          list.map((c) => ({ item: c, weight: 1 })),
          inner,
        ),
      };
    });
  }, [cells, width, height]);

  const markRect = marked
    ? layout.flatMap((g) => g.files).find((f) => f.item.path === marked)
    : undefined;
  const hovered = hover ? stats[hover] : undefined;
  const readCount = Object.values(stats).filter((s) => s.edits === 0).length;
  const editCount = Object.values(stats).filter((s) => s.edits > 0).length;

  return (
    <div>
      <div ref={ref} className="relative w-full" style={{ height }}>
        {files.length === 0 && Object.keys(stats).length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-text-subtle">
            {t("live.map.empty")}
          </div>
        ) : (
          <svg
            width={width}
            height={height}
            className="block"
            role="img"
            aria-label={t("live.map.label")}
          >
            {layout.map(({ group, files }) => (
              <g key={group.item || "/"}>
                {group.h > 36 && group.w > 56 && (
                  <text
                    x={group.x + GAP + 1}
                    y={group.y + 10}
                    className="fill-text-subtle font-mono"
                    style={{ fontSize: 9.5 }}
                  >
                    {(group.item || "/").slice(0, Math.floor(group.w / 6))}
                  </text>
                )}
                {files.map((f) => {
                  const { color, opacity } = fill(f.item.stat);
                  const name = f.item.path.slice(f.item.path.lastIndexOf("/") + 1);
                  return (
                    <g key={`${f.item.path}:${f.item.stat?.lastAt ?? 0}`}>
                      {/* biome-ignore lint/a11y/noStaticElementInteractions: hovering only names the file in the line below; its <title> does the same for assistive tech */}
                      <rect
                        x={f.x + 0.5}
                        y={f.y + 0.5}
                        width={Math.max(0, f.w - 1)}
                        height={Math.max(0, f.h - 1)}
                        rx={1.5}
                        fill={color}
                        fillOpacity={opacity}
                        className={f.item.stat ? "anim-cell-flash" : undefined}
                        onMouseEnter={() => setHover(f.item.path)}
                        onMouseLeave={() => setHover((h) => (h === f.item.path ? null : h))}
                      >
                        <title>{f.item.path}</title>
                      </rect>
                      {f.w > 64 && f.h > 18 && (
                        <text
                          x={f.x + 5}
                          y={f.y + 13}
                          className={`pointer-events-none font-mono ${f.item.stat ? "fill-text" : "fill-text-subtle"}`}
                          style={{ fontSize: 9.5 }}
                        >
                          {name.length * 6 > f.w - 10
                            ? `${name.slice(0, Math.max(1, Math.floor((f.w - 10) / 6) - 1))}…`
                            : name}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            ))}
          </svg>
        )}
        {markRect && (
          <div
            className="pointer-events-none absolute transition-all duration-500 ease-out"
            style={{
              left: markRect.x + markRect.w / 2 - 5,
              top: markRect.y + markRect.h / 2 - 5,
            }}
          >
            <span
              className="anim-pulse-ring absolute inset-0 rounded-full"
              style={{ background: `var(--c-act-${session?.state ?? "other"})` }}
            />
            <span
              className="relative block size-2.5 rounded-full ring-2 ring-surface"
              style={{ background: `var(--c-act-${session?.state ?? "other"})` }}
            />
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center gap-4 text-fs-11 text-text-subtle">
        <span className="min-w-0 flex-1 truncate font-mono">
          {hover
            ? `${hover}${
                hovered
                  ? `  ·  ${t("live.map.hover", { reads: hovered.reads, edits: hovered.edits })}${
                      hovered.added || hovered.removed
                        ? `  +${hovered.added} −${hovered.removed}`
                        : ""
                    }`
                  : ""
              }`
            : cells.total > cells.shown
              ? t("live.map.capped", { shown: cells.shown, total: cells.total })
              : t("live.map.count", { n: cells.total })}
        </span>
        <Legend color="var(--c-act-read)" label={t("live.map.read", { n: readCount })} />
        <Legend color="var(--c-act-edit)" label={t("live.map.edited", { n: editCount })} />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className="size-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
