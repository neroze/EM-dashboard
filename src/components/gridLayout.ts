// The widget grid's geometry, pure (unit-tested in test/domain.test.ts).
//
// Columns + vertical compaction — the model dashboard tools such as Grafana
// use: a widget the viewer placed keeps its column, and every widget sits as
// high as the widgets above it in its columns allow. Widgets nobody placed
// fall into the shortest column (masonry). Dragging therefore only ever
// changes the dragged widget's column and its place in its columns' stacks:
// the other widgets slide up or down, never jump sideways.

export const GAP = 14;

// ---- row units: every widget is 1×–4× a row tall, the row fitted to the screen ----
export const MAX_SPAN = 4;
export const MIN_ROW = 200;
/** rows per screen (2–4) and the row height that makes them fill `viewH` exactly */
export function rowUnit(viewH: number): { rows: number; rowH: number } {
  const rows = Math.max(2, Math.min(MAX_SPAN, Math.floor((viewH + GAP) / (MIN_ROW + GAP))));
  return { rows, rowH: Math.max(MIN_ROW * 0.75, (viewH - GAP * (rows - 1)) / rows) };
}
/** px height of a widget `rows` units tall */
export const unitsPx = (rows: number, rowH: number) => rows * rowH + (rows - 1) * GAP;
/** the fewest rows (1–4) that show `natural` px of content */
export function rowsFor(natural: number, rowH: number): number {
  return Math.max(1, Math.min(MAX_SPAN, Math.ceil((natural + GAP - 0.5) / (rowH + GAP))));
}
/** columns that fit `width` at ≥ minCol px each, at most `max` */
export function columnsFor(width: number, minCol: number, max = Infinity): number {
  return Math.max(1, Math.min(max, Math.floor((width + GAP) / (minCol + GAP))));
}
export interface Box { left: number; top: number; width: number; col: number; span: number }

export interface PackInput {
  order: string[];
  span: (k: string) => number;      // wanted span (capped to cols here)
  height: (k: string) => number;
  cols: number; colW: number;
  /** the viewer-chosen column, or undefined = shortest column */
  col?: (k: string) => number | undefined;
}

export function pack({ order, span: spanOf, height, cols, colW, col }: PackInput) {
  const pos = new Map<string, Box>();
  const colH = new Array(cols).fill(0);
  const topAt = (c: number, span: number) => Math.max(...colH.slice(c, c + span));
  for (const k of order) {
    const span = Math.max(1, Math.min(cols, spanOf(k)));
    const want = col?.(k);
    let best = 0, bestTop = Infinity;
    if (want !== undefined) { best = Math.max(0, Math.min(cols - span, want)); bestTop = topAt(best, span); }
    else for (let c = 0; c + span <= cols; c++) { const t = topAt(c, span); if (t < bestTop - 0.5) { best = c; bestTop = t; } }
    pos.set(k, { left: best * (colW + GAP), top: bestTop, width: colW * span + GAP * (span - 1), col: best, span });
    for (let c = best; c < best + span; c++) colH[c] = bestTop + height(k) + GAP;
  }
  return { pos, height: Math.max(0, ...colH) - GAP };
}

/** top to bottom, then left to right — the order the viewer reads */
export function visualOrder(pos: Map<string, Box>): string[] {
  return [...pos].sort((a, b) => a[1].top - b[1].top || a[1].left - b[1].left).map(([k]) => k);
}

/** every widget's current column (to freeze the layout before a drag) */
export function columnsOf(pos: Map<string, Box>): Record<string, number> {
  return Object.fromEntries([...pos].map(([k, b]) => [k, b.col]));
}

/**
 * Where a dragged widget goes: the column under its (dragged) left edge, and
 * the place in that column's stack whose top is nearest its (dragged) top.
 * `left`/`top` are where the widget's top-left corner would be, in grid px.
 * `cols` maps every widget to its column (frozen at drag start).
 */
export function dropPlan(input: Omit<PackInput, 'col'> & { key: string; left: number; top: number; at: Record<string, number> }) {
  const { key, left, top, at, order, cols, colW } = input;
  const span = Math.max(1, Math.min(cols, input.span(key)));
  const col = Math.max(0, Math.min(cols - span, Math.round(left / (colW + GAP))));
  const colOf = (k: string) => (k === key ? col : at[k]);
  const rest = order.filter((k) => k !== key);
  const topOf = (o: string[]) => pack({ ...input, order: o, col: colOf }).pos.get(key)!.top;
  // keep the current stacking unless another is clearly nearer (no flicker between two)
  let best = order, bestD = Math.abs(topOf(order) - top);
  for (let i = 0; i <= rest.length; i++) {
    const cand = [...rest.slice(0, i), key, ...rest.slice(i)];
    const d = Math.abs(topOf(cand) - top);
    if (d < bestD - 8) { best = cand; bestD = d; }
  }
  return { order: best, col };
}
