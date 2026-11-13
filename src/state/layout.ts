// Saved widget / section order (and widget widths) per grid id (localStorage — a per-viewer
// convenience; when storage is unavailable the order just isn't remembered).
const STORE = 'layout:';
export const LAYOUT_RESET_EVENT = 'leave-radar:layout-reset';

export function loadLayout(id: string): string[] {
  try { const v = JSON.parse(localStorage.getItem(STORE + id) || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

export function saveLayout(id: string, order: string[]) {
  try { localStorage.setItem(STORE + id, JSON.stringify(order)); } catch { /* storage unavailable */ }
}

/** saved column spans per widget key */
export function loadSizes(id: string): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(STORE + id + ':sizes') || '{}');
    return v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, n]) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 6)) as Record<string, number> : {};
  } catch { return {}; }
}

export function saveSizes(id: string, sizes: Record<string, number>) {
  try { localStorage.setItem(STORE + id + ':sizes', JSON.stringify(sizes)); } catch { /* storage unavailable */ }
}

export const AUTO_LAYOUT_EVENT = 'leave-radar:auto-layout';
/** ask every grid to arrange itself for the current window (see Sortable) */
export function autoLayout() { window.dispatchEvent(new Event(AUTO_LAYOUT_EVENT)); }

/** forget every saved layout (all Sortables re-render in default order) */
export function resetLayouts() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(STORE)) localStorage.removeItem(k);
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(LAYOUT_RESET_EVENT));
}

/** "Auto layout" plan at `cols` columns. Items come in context order
 *  (today → week → month → …). `fixed` items keep the width the user set
 *  (capped to the columns that fit); the rest start at their default, widen
 *  when unusually tall (≥ 3 columns), and take a row's spare columns so rows
 *  end flush. Rows are filled in context order, looking up to LOOKAHEAD items
 *  ahead for one that fits the space left — so user widths are packed around
 *  rather than overridden. */
export interface AutoItem { key: string; want: number; h: number; fixed: boolean }
const LOOKAHEAD = 3;

export function autoPlan(items: AutoItem[], cols: number): { order: string[]; spans: Record<string, number> } {
  const span = new Map(items.map((x) => [x.key, Math.max(1, Math.min(cols, x.want))]));
  const hs = items.map((x) => x.h).filter((h) => h > 0).sort((a, b) => a - b);
  const median = hs.length ? hs[Math.floor(hs.length / 2)] : 0;
  if (cols >= 3 && median) for (const x of items) if (!x.fixed && span.get(x.key) === 1 && x.h > median * 1.8) span.set(x.key, 2);

  const left = [...items];
  const order: string[] = [];
  while (left.length) {
    const row: AutoItem[] = [];
    let used = 0;
    while (left.length && used < cols) {
      const room = cols - used;
      const i = left.slice(0, LOOKAHEAD + 1).findIndex((x) => span.get(x.key)! <= room);
      if (i < 0) break;
      const [x] = left.splice(i, 1);
      row.push(x); used += span.get(x.key)!;
    }
    // spare columns → the row's tallest widget the user hasn't sized
    const spare = cols - used;
    const flex = row.filter((x) => !x.fixed);
    if (spare > 0 && flex.length) {
      const tallest = flex.reduce((a, x) => (x.h > a.h ? x : a), flex[0]);
      span.set(tallest.key, Math.min(cols, span.get(tallest.key)! + spare));
    }
    order.push(...row.map((x) => x.key));
  }
  return { order, spans: Object.fromEntries(span) };
}

/** widths only (no reordering, nothing fixed) — kept for callers/tests */
export function autoSpans(items: { want: number; h: number }[], cols: number): number[] {
  const plan = autoPlan(items.map((x, i) => ({ key: String(i), want: x.want, h: x.h, fixed: false })), cols);
  // autoSpans keeps the given order: only valid when nothing needed reordering
  return items.map((_, i) => plan.spans[String(i)]);
}
