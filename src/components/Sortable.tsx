// Drag-and-drop reorderable grid. Each item gets a grip (shown on hover);
// dragging it reorders live, arrow keys on the focused grip move it too.
//
// With `grid`, items are also RESIZABLE and the layout is a responsive
// packed grid: the column count follows the container width (≥ minCol px
// per column), each item spans 1…N columns (drag its right edge, double-
// click it to reset, or Shift+←/→ on the grip), and items are packed into
// the shortest columns so different widths leave no holes. A span never
// exceeds the columns that fit, so narrow windows fall back to fewer columns.
//
// Order and widths are saved per `id` in localStorage (a per-viewer
// convenience — when storage is unavailable they just aren't remembered).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AUTO_LAYOUT_EVENT, autoPlan, LAYOUT_RESET_EVENT, loadLayout, loadSizes, saveLayout, saveSizes } from '../state/layout.ts';

/** span: default column span (1 by default); className 'span-2' also means 2 */
export interface SortItem { key: string; node: ReactNode; className?: string; span?: number }

const GAP = 14;

/** saved order applied to the current keys; unknown keys keep their default slot */
function arrange(keys: string[], saved: string[]): string[] {
  const known = saved.filter((k) => keys.includes(k));
  const out = [...known];
  keys.forEach((k, i) => {
    if (out.includes(k)) return;
    // insert after the nearest preceding default-order key already placed
    const prev = keys.slice(0, i).reverse().find((p) => out.includes(p));
    out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, k);
  });
  return out;
}

export function Sortable({ id, items, className, label = 'widget', grid = false, minCol = 290 }: {
  id: string; items: SortItem[]; className?: string; label?: string;
  /** responsive packed grid with resizable widths */
  grid?: boolean;
  /** narrowest a column may get before the grid drops a column */
  minCol?: number;
}) {
  const keys = items.map((i) => i.key);
  const [saved, setSaved] = useState<string[]>(() => loadLayout(id));
  const [sizes, setSizes] = useState<Record<string, number>>(() => loadSizes(id));
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null); // grip pressed: that item may start a drag
  const [resizing, setResizing] = useState<{ key: string; span: number } | null>(null);
  const lastOver = useRef<string | null>(null);
  // grid mode: widgets glide to their new place after a move; ignore drag-overs
  // until they settle, or the moving widgets themselves trigger more swaps
  const settleUntil = useRef(0);
  const order = arrange(keys, saved);

  // ---- measuring (grid mode) -------------------------------------------------
  const box = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLDivElement>());
  const [width, setWidth] = useState(0);
  const [heights, setHeights] = useState<Record<string, number>>({});

  useLayoutEffect(() => {
    if (!grid || !box.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [grid]);

  useLayoutEffect(() => {
    if (!grid) return;
    const ro = new ResizeObserver((entries) => {
      setHeights((h) => {
        let next = h;
        for (const e of entries) {
          const k = (e.target as HTMLElement).dataset.key!;
          const v = Math.ceil((e.target as HTMLElement).offsetHeight);
          if (h[k] !== v) { if (next === h) next = { ...h }; next[k] = v; }
        }
        return next;
      });
    });
    for (const el of els.current.values()) ro.observe(el);
    return () => ro.disconnect();
  }, [grid, keys.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onReset = () => { setSaved([]); setSizes({}); };
    window.addEventListener(LAYOUT_RESET_EVENT, onReset);
    return () => window.removeEventListener(LAYOUT_RESET_EVENT, onReset);
  }, []);

  // "Auto layout": context order + widths fitted to the current window
  const autoRef = useRef<() => void>(() => {});
  useEffect(() => {
    const on = () => autoRef.current();
    window.addEventListener(AUTO_LAYOUT_EVENT, on);
    return () => window.removeEventListener(AUTO_LAYOUT_EVENT, on);
  }, []);

  const commit = useCallback((next: string[]) => { setSaved(next); saveLayout(id, next); }, [id]);
  const commitSize = useCallback((key: string, span: number | null) => {
    setSizes((s) => {
      const next = { ...s };
      if (span === null) delete next[key]; else next[key] = span;
      saveSizes(id, next);
      return next;
    });
  }, [id]);

  const moveTo = (key: string, target: string) => {
    if (key === target) return;
    const cur = arrange(keys, saved);
    const from = cur.indexOf(key), to = cur.indexOf(target);
    cur.splice(from, 1);
    cur.splice(to, 0, key);
    setSaved(cur);
  };

  // ---- packed layout (grid mode) ---------------------------------------------
  const byKey = new Map(items.map((i) => [i.key, i]));
  const cols = grid && width ? Math.max(1, Math.floor((width + GAP) / (minCol + GAP))) : 1;
  const colW = grid && width ? (width - GAP * (cols - 1)) / cols : 0;
  const defaultSpan = (it: SortItem) => it.span ?? (/\bspan-2\b/.test(it.className ?? '') ? 2 : 1);
  const spanOf = (k: string) => {
    const it = byKey.get(k)!;
    const want = resizing?.key === k ? resizing.span : sizes[k] ?? defaultSpan(it);
    return Math.max(1, Math.min(cols, want));
  };
  const pos = new Map<string, { left: number; top: number; width: number }>();
  let gridH = 0;
  const measured = grid && width > 0 && order.every((k) => heights[k] !== undefined);
  if (grid && width) {
    const colH = new Array(cols).fill(0);
    for (const k of order) {
      const span = spanOf(k);
      let best = 0, bestTop = Infinity;
      for (let c = 0; c + span <= cols; c++) {
        const top = Math.max(...colH.slice(c, c + span));
        if (top < bestTop - 0.5) { best = c; bestTop = top; }
      }
      const w = colW * span + GAP * (span - 1);
      pos.set(k, { left: best * (colW + GAP), top: bestTop, width: w });
      const h = heights[k] ?? 0;
      for (let c = best; c < best + span; c++) colH[c] = bestTop + h + GAP;
    }
    gridH = Math.max(0, ...colH) - GAP;
  }

  const autoArrange = () => {
    if (!grid || !width) { commit(keys); return; } // sections: just the context order
    // context order (the default), user-set widths kept as they are
    const plan = autoPlan(keys.map((k) => ({
      key: k, h: heights[k] ?? 0,
      fixed: sizes[k] !== undefined,
      want: sizes[k] ?? defaultSpan(byKey.get(k)!),
    })), cols);
    commit(plan.order);
    const next: Record<string, number> = {};
    for (const k of keys) {
      if (sizes[k] !== undefined) next[k] = sizes[k]; // the user's width, untouched (even if capped right now)
      else if (plan.spans[k] !== defaultSpan(byKey.get(k)!)) next[k] = plan.spans[k];
    }
    setSizes(next);
    saveSizes(id, next);
  };
  useEffect(() => { autoRef.current = autoArrange; }); // latest layout state, set after each render

  // ---- resize by dragging the right edge -------------------------------------
  const startResize = (e: React.PointerEvent, k: string) => {
    if (!grid || !colW) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX, startSpan = spanOf(k);
    let span = startSpan;
    setResizing({ key: k, span });
    const move = (ev: PointerEvent) => {
      const next = Math.max(1, Math.min(cols, Math.round(startSpan + (ev.clientX - startX) / (colW + GAP))));
      if (next !== span) { span = next; setResizing({ key: k, span }); }
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setResizing(null);
      if (span !== startSpan) commitSize(k, span === defaultSpan(byKey.get(k)!) ? null : span);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    <div ref={box} className={(className ?? '') + (grid ? ' sort-grid' + (measured ? ' ready' : '') : '')}
      style={grid ? { height: measured ? gridH : undefined } : undefined}>
      {order.map((k, idx) => {
        const it = byKey.get(k)!;
        const p = pos.get(k);
        const span = grid ? spanOf(k) : 1;
        return (
          <div key={k} data-key={k}
            ref={(el) => { if (el) els.current.set(k, el); else els.current.delete(k); }}
            className={'sort-item' + (it.className ? ' ' + it.className : '') + (dragKey === k ? ' dragging' : '') + (dragKey && dragKey !== k ? ' drop-ok' : '') + (resizing?.key === k ? ' resizing' : '')}
            style={grid && p ? { position: 'absolute', left: p.left, top: p.top, width: p.width } : undefined}
            draggable={armed === k}
            onDragStart={(e) => {
              if (e.target !== e.currentTarget) return; // a nested sortable's drag
              e.stopPropagation();
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', k);
              lastOver.current = null;
              setDragKey(k);
            }}
            onDragOver={(e) => {
              if (!dragKey) return; // not our drag
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              if (lastOver.current === k) return;
              if (grid && performance.now() < settleUntil.current) return;
              lastOver.current = k;
              moveTo(dragKey, k);
              if (grid) settleUntil.current = performance.now() + 260;
            }}
            onDragLeave={(e) => { if (dragKey && e.target === e.currentTarget && lastOver.current === k) lastOver.current = null; }}
            onDrop={(e) => { if (!dragKey) return; e.preventDefault(); e.stopPropagation(); }}
            onDragEnd={(e) => {
              if (e.target !== e.currentTarget) return;
              setDragKey(null); setArmed(null); lastOver.current = null;
              commit(arrange(keys, saved));
            }}>
            <button type="button" className="sort-grip"
              aria-label={`Move ${label} (drag, or arrow keys)${grid ? '; Shift+arrow keys change its width' : ''}`}
              title={grid ? 'Drag to reorder · Shift+←/→ to change width' : 'Drag to reorder'}
              onMouseDown={() => setArmed(k)} onMouseUp={() => !dragKey && setArmed(null)}
              onKeyDown={(e) => {
                if (grid && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                  e.preventDefault();
                  const next = Math.max(1, Math.min(cols, span + (e.key === 'ArrowRight' ? 1 : -1)));
                  if (next !== span) commitSize(k, next === defaultSpan(it) ? null : next);
                  return;
                }
                const delta = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0;
                if (!delta) return;
                e.preventDefault();
                const target = order[idx + delta];
                if (!target) return;
                const next = [...order];
                next.splice(idx, 1);
                next.splice(idx + delta, 0, k);
                commit(next);
                // keep focus on the moved grip
                const el = e.currentTarget;
                requestAnimationFrame(() => el.focus());
              }}>
              <svg viewBox="0 0 10 16" width="8" height="12" aria-hidden="true">
                {[3, 8, 13].map((y) => [2.5, 7.5].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.3" fill="currentColor" />))}
              </svg>
            </button>
            {it.node}
            {grid && cols > 1 && (
              <div className="sort-resize" role="separator" aria-orientation="vertical"
                title={`Drag to resize (${span} of ${cols} column${cols === 1 ? '' : 's'}) · double-click to reset`}
                onPointerDown={(e) => startResize(e, k)}
                onDoubleClick={() => commitSize(k, null)}>
                {resizing?.key === k && <span className="sort-resize-badge">{span} / {cols}</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
