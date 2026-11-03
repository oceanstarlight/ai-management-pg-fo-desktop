import { useEffect, useRef, useState } from "react";
import { getPref, onPrefChanged, setPref } from "../store/prefs";

/**
 * A width the user sets by dragging, kept in prefs (`key`), between `min`
 * and `max`. `dragging` is true while the edge is held.
 */
export function useResizableWidth(key: string, initial: number, min: number, max: number) {
  const read = () => {
    const n = Number(getPref(key));
    return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, n)) : initial;
  };
  const [width, setWidth] = useState(read);
  const [dragging, setDragging] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the pref only
  useEffect(() => onPrefChanged(key, () => setWidth(read())), [key]);
  const set = (w: number, save: boolean) => {
    const next = Math.round(Math.min(max, Math.max(min, w)));
    setWidth(next);
    if (save) setPref(key, String(next));
  };
  const reset = () => {
    setWidth(initial);
    setPref(key, null);
  };
  return { width, dragging, setDragging, set, reset, min, max };
}

/**
 * The draggable edge of a side panel. `side` is the panel's edge it sits on:
 * `right` for a panel on the left (dragging right widens it), `left` for a
 * panel on the right. Double-click puts the width back.
 */
export function ResizeHandle({
  side,
  label,
  state,
  className = "",
}: {
  side: "left" | "right";
  label: string;
  state: ReturnType<typeof useResizableWidth>;
  className?: string;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const step = 16;
  const sign = side === "right" ? 1 : -1;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a vertical splitter has no native element
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={state.width}
      aria-valuemin={state.min}
      aria-valuemax={state.max}
      tabIndex={0}
      title={label}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: state.width };
        state.setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        state.set(start.current.w + sign * (e.clientX - start.current.x), false);
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        state.set(start.current.w + sign * (e.clientX - start.current.x), true);
        start.current = null;
        state.setDragging(false);
      }}
      onPointerCancel={() => {
        start.current = null;
        state.setDragging(false);
      }}
      onDoubleClick={state.reset}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") state.set(state.width - sign * step, true);
        if (e.key === "ArrowRight") state.set(state.width + sign * step, true);
      }}
      className={`group absolute top-0 bottom-0 z-20 w-2 cursor-col-resize touch-none outline-none ${
        side === "right" ? "-right-1" : "-left-1"
      } ${className}`}
    >
      <span
        className={`absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2 transition-colors ${
          state.dragging
            ? "bg-accent"
            : "bg-transparent group-hover:bg-border-strong group-focus-visible:bg-accent"
        }`}
      />
    </div>
  );
}
