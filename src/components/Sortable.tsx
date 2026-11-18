// Drag-and-drop reorderable widgets. Each item gets a grip (shown on hover).
//
// List mode (default): items reorder in a single flow; dragging over another
// item takes its place; arrow keys on the focused grip move it too.
//
// Grid mode (`grid`): a responsive grid of columns (≥ minCol px each) where
// widgets are RESIZABLE (drag the right edge, double-click it to reset, or
// Shift+←/→ on the grip) and placed like a dashboard tool's grid — see
// gridLayout.ts: a widget the viewer dragged keeps its column, every widget
// sits as high as the ones above it allow, and widgets nobody placed fill the
// shortest column (masonry). While dragging, the widget follows the pointer:
// the column under it, and the slot in that column's stack nearest it —
// empty columns and the space below the last widget included. The other
// widgets only slide up or down in their own columns.
//
// Row units (`units`, grid mode): every widget is 1×–4× a column wide and
// 1×–4× a row tall; the row height is fitted so 2–4 rows fill the visible
// height, and columns are capped at `maxCols` so 4× is exactly full width.
// A widget starts at the fewest rows that show its content; content taller
// than its box fades out under a "More" button that opens the whole widget
// in a pop-up. Drag the bottom edge (or Shift+↑/↓) to set the height, the
// corner to set both.
//
// Order, widths and columns are saved per `id` in localStorage (a per-viewer
// convenience). Columns are saved with the column count they were set at; at
// another window width the grid falls back to masonry in the same order.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AUTO_LAYOUT_EVENT, autoPlan, LAYOUT_RESET_EVENT, loadLayout, loadPlacement, loadRows, loadSizes, saveLayout, savePlacement, saveRows, saveSizes, type Placement } from '../state/layout.ts';
import { columnsFor, columnsOf, dropPlan, GAP, MAX_SPAN, pack, rowsFor, rowUnit, unitsPx, visualOrder, type Box } from './gridLayout.ts';

/** span: default column span (1 by default); className 'span-2' also means 2 */
export interface SortItem { key: string; node: ReactNode; className?: string; span?: number }

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

/** how tall a widget's content is, however tall its box: the lowest child's bottom + padding */
function naturalHeight(card: HTMLElement): number {
  const r = card.getBoundingClientRect();
  let bottom = 0;
  for (const c of card.children) { const b = c.getBoundingClientRect(); if (b.height > 0) bottom = Math.max(bottom, b.bottom - r.top); }
  const cs = getComputedStyle(card);
  return Math.ceil(bottom + parseFloat(cs.paddingBottom || '0') + parseFloat(cs.borderBottomWidth || '0'));
}

/** the nearest scrolling ancestor (whose visible height the rows fill) */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === 'auto' || o === 'scroll') return p;
  }
  return null;
}

export function Sortable({ id, items, className, label = 'widget', grid = false, minCol = 290, units = false, maxCols }: {
  id: string; items: SortItem[]; className?: string; label?: string;
  /** responsive grid with resizable widths */
  grid?: boolean;
  /** narrowest a column may get before the grid drops a column */
  minCol?: number;
  /** grid: widgets snap to 1–4 row units fitted to the visible height (see top) */
  units?: boolean;
  /** grid: at most this many columns */
  maxCols?: number;
}) {
  units = units && grid;
  const keys = items.map((i) => i.key);
  const [saved, setSaved] = useState<string[]>(() => loadLayout(id));
  const [sizes, setSizes] = useState<Record<string, number>>(() => loadSizes(id));
  const [placement, setPlacement] = useState<Placement | null>(() => loadPlacement(id));
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null); // grip pressed: that item may start a drag
  const [resizing, setResizing] = useState<{ key: string; span: number; rows: number } | null>(null);
  const [rowsSet, setRowsSet] = useState<Record<string, number>>(() => loadRows(id)); // units: heights the viewer set
  const [naturals, setNaturals] = useState<Record<string, number>>({});              // units: content heights
  const [viewH, setViewH] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);                    // units: widget open in the pop-up
  const lastOver = useRef<string | null>(null);
  const grab = useRef({ x: 0, y: 0 }); // where in the widget the pointer holds it
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

  // units: the visible height the rows fill
  useLayoutEffect(() => {
    if (!units) return;
    const sp = scrollParent(box.current);
    const read = () => setViewH(Math.floor(sp ? sp.clientHeight : window.innerHeight));
    read();
    const ro = sp ? new ResizeObserver(read) : null;
    ro?.observe(sp!);
    window.addEventListener('resize', read);
    return () => { ro?.disconnect(); window.removeEventListener('resize', read); };
  }, [units]);

  // units: each widget's content height — after every render, and when anything inside changes
  const measure = useCallback(() => {
    if (!units) return;
    setNaturals((cur) => {
      let next = cur;
      for (const [k, el] of els.current) {
        const card = el.querySelector<HTMLElement>(':scope > .sort-body > *');
        if (!card) continue;
        const v = naturalHeight(card);
        if (Math.abs((cur[k] ?? -99) - v) > 1) { if (next === cur) next = { ...cur }; next[k] = v; }
      }
      return next;
    });
  }, [units]);
  useLayoutEffect(() => { measure(); });
  useEffect(() => {
    if (!units || !box.current) return;
    let raf = 0;
    const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    const mo = new MutationObserver(later);
    mo.observe(box.current, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'open', 'aria-expanded'] });
    return () => { mo.disconnect(); cancelAnimationFrame(raf); };
  }, [units, measure]);

  useEffect(() => {
    if (!expanded) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(null); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [expanded]);

  useEffect(() => {
    const onReset = () => { setSaved([]); setSizes({}); setPlacement(null); setRowsSet({}); };
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
  const commitPlacement = useCallback((p: Placement | null) => { setPlacement(p); savePlacement(id, p); }, [id]);
  const commitRows = useCallback((key: string, rows: number | null) => {
    setRowsSet((s) => {
      const next = { ...s };
      if (rows === null) delete next[key]; else next[key] = rows;
      saveRows(id, next);
      return next;
    });
  }, [id]);
  const commitSize = useCallback((key: string, span: number | null) => {
    setSizes((s) => {
      const next = { ...s };
      if (span === null) delete next[key]; else next[key] = span;
      saveSizes(id, next);
      return next;
    });
  }, [id]);

  // list mode: dragging over an item takes its place
  const moveTo = (key: string, target: string) => {
    if (key === target) return;
    const cur = arrange(keys, saved);
    const from = cur.indexOf(key), to = cur.indexOf(target);
    cur.splice(from, 1);
    cur.splice(to, 0, key);
    setSaved(cur);
  };

  // ---- grid layout -------------------------------------------------------------
  const byKey = new Map(items.map((i) => [i.key, i]));
  const cols = grid && width ? columnsFor(width, minCol, units ? Math.min(maxCols ?? MAX_SPAN, MAX_SPAN) : maxCols) : 1;
  const colW = grid && width ? (width - GAP * (cols - 1)) / cols : 0;
  const defaultSpan = (it: SortItem) => it.span ?? (/\bspan-2\b/.test(it.className ?? '') ? 2 : 1);
  const spanOf = (k: string) => {
    const it = byKey.get(k)!;
    const want = resizing?.key === k ? resizing.span : sizes[k] ?? defaultSpan(it);
    return Math.max(1, Math.min(cols, want));
  };
  const { rowH } = rowUnit(viewH || 800);
  const autoRows = (k: string) => (naturals[k] ? rowsFor(naturals[k], rowH) : 1);
  const rowsOf = (k: string) => (resizing?.key === k ? resizing.rows : rowsSet[k] ?? autoRows(k));
  const hOf = (k: string) => (units ? unitsPx(rowsOf(k), rowH) : heights[k] ?? 0);
  // placed columns apply only at the column count they were set for
  const at = placement && placement.n === cols ? placement.at : null;
  const colOf = (k: string) => at?.[k];
  const measured = grid && width > 0 && (units ? viewH > 0 && order.every((k) => naturals[k] !== undefined) : order.every((k) => heights[k] !== undefined));
  const packed = grid && width ? pack({ order, span: spanOf, height: hOf, cols, colW, col: colOf }) : { pos: new Map<string, Box>(), height: 0 };
  const pos = packed.pos, gridH = packed.height;

  /** freeze every widget's column, so a drag only ever moves the dragged one sideways */
  const frozen = () => ({ n: cols, at: columnsOf(pos) });

  const dragOverGrid = (e: React.DragEvent) => {
    if (!grid || !dragKey || !box.current) return; // not this grid's drag (a nested/outer one handles it)
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const r = box.current.getBoundingClientRect();
    const plan = dropPlan({
      key: dragKey, order, span: spanOf, height: hOf, cols, colW, at: at ?? columnsOf(pos),
      left: e.clientX - r.left - grab.current.x, top: e.clientY - r.top - grab.current.y,
    });
    if (plan.order !== order) setSaved(plan.order);
    if (!at || at[dragKey] !== plan.col) setPlacement({ n: cols, at: { ...(at ?? columnsOf(pos)), [dragKey]: plan.col } });
  };

  const endGridDrag = () => {
    // save in reading order (so a narrower window's masonry keeps it) with the columns as placed
    commit(visualOrder(pos));
    commitPlacement(at ? { n: cols, at: { ...at } } : frozen());
  };

  const autoArrange = () => {
    if (!grid || !width) { commit(keys); return; } // sections: just the context order
    // context order (the default), user-set widths kept as they are; columns back to masonry
    const plan = autoPlan(keys.map((k) => ({
      key: k, h: heights[k] ?? 0,
      fixed: sizes[k] !== undefined,
      want: sizes[k] ?? defaultSpan(byKey.get(k)!),
    })), cols);
    commit(plan.order);
    commitPlacement(null);
    if (units) { setRowsSet({}); saveRows(id, {}); } // heights back to fitting the content
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
  const startResize = (e: React.PointerEvent, k: string, axis: 'x' | 'y' | 'xy' = 'x') => {
    if (!grid || !colW) return;
    e.preventDefault();
    e.stopPropagation();
    // the others keep their columns while this one widens (no sideways jumps)
    if (!at) setPlacement(frozen());
    const startX = e.clientX, startY = e.clientY, startSpan = spanOf(k), startRows = rowsOf(k);
    let span = startSpan, rows = startRows;
    setResizing({ key: k, span, rows });
    const move = (ev: PointerEvent) => {
      const nx = axis === 'y' ? span : Math.max(1, Math.min(cols, Math.round(startSpan + (ev.clientX - startX) / (colW + GAP))));
      const ny = axis === 'x' ? rows : Math.max(1, Math.min(MAX_SPAN, Math.round(startRows + (ev.clientY - startY) / (rowH + GAP))));
      if (nx !== span || ny !== rows) { span = nx; rows = ny; setResizing({ key: k, span, rows }); }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setResizing(null);
      if (span !== startSpan) commitSize(k, span === defaultSpan(byKey.get(k)!) ? null : span);
      if (rows !== startRows) commitRows(k, rows);
      setPlacement((p) => { savePlacement(id, p); return p; });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /** keyboard on the grip: grid ←/→ = column, ↑/↓ = up/down its stack; list = previous/next */
  const onGripKey = (e: React.KeyboardEvent<HTMLButtonElement>, k: string, idx: number, span: number, it: SortItem) => {
    if (units && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const r = rowsOf(k), next = Math.max(1, Math.min(MAX_SPAN, r + (e.key === 'ArrowDown' ? 1 : -1)));
      if (next !== r) { if (!at) commitPlacement(frozen()); commitRows(k, next); }
      return;
    }
    if (grid && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const next = Math.max(1, Math.min(cols, span + (e.key === 'ArrowRight' ? 1 : -1)));
      if (next !== span) { if (!at) commitPlacement(frozen()); commitSize(k, next === defaultSpan(it) ? null : next); }
      return;
    }
    const keep = e.currentTarget;
    const refocus = () => requestAnimationFrame(() => keep.focus());
    if (grid && pos.size) {
      const me = pos.get(k)!;
      const cur = at ?? columnsOf(pos);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const c = Math.max(0, Math.min(cols - me.span, me.col + (e.key === 'ArrowRight' ? 1 : -1)));
        if (c !== me.col) { commitPlacement({ n: cols, at: { ...cur, [k]: c } }); refocus(); }
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        // swap with the nearest widget above/below that shares a column
        const vis = visualOrder(pos);
        const overlaps = (o: string) => { const b = pos.get(o)!; return b.col < me.col + me.span && me.col < b.col + b.span; };
        const i = vis.indexOf(k);
        const step = e.key === 'ArrowUp' ? -1 : 1;
        let j = i + step;
        while (j >= 0 && j < vis.length && !overlaps(vis[j])) j += step;
        if (j < 0 || j >= vis.length) return;
        const next = [...vis];
        next.splice(i, 1);
        next.splice(next.indexOf(vis[j]) + (step > 0 ? 1 : 0), 0, k);
        commit(next);
        commitPlacement({ n: cols, at: cur });
        refocus();
      }
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
    refocus();
  };

  return (
    <>
    <div ref={box} className={(className ?? '') + (grid ? ' sort-grid' + (units ? ' sort-units' : '') + (measured ? ' ready' : '') + (dragKey ? ' drag-on' : '') : '')}
      style={grid ? { height: measured ? gridH + (dragKey ? 160 : 0) : undefined } : undefined}
      onDragOver={grid ? dragOverGrid : undefined}
      onDrop={grid ? (e) => { if (dragKey) { e.preventDefault(); e.stopPropagation(); } } : undefined}>
      {order.map((k, idx) => {
        const it = byKey.get(k)!;
        const p = pos.get(k);
        const span = grid ? spanOf(k) : 1;
        return (
          <div key={k} data-key={k}
            ref={(el) => { if (el) els.current.set(k, el); else els.current.delete(k); }}
            className={'sort-item' + (it.className ? ' ' + it.className : '') + (dragKey === k ? ' dragging' : '') + (dragKey && dragKey !== k ? ' drop-ok' : '') + (resizing?.key === k ? ' resizing' : '')}
            style={grid && p ? { position: 'absolute', left: p.left, top: p.top, width: p.width, ...(units ? { height: hOf(k) } : {}) } : undefined}
            draggable={armed === k}
            onDragStart={(e) => {
              if (e.target !== e.currentTarget) return; // a nested sortable's drag
              e.stopPropagation();
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', k);
              const r = e.currentTarget.getBoundingClientRect();
              grab.current = { x: e.clientX - r.left, y: e.clientY - r.top };
              if (grid && !at) setPlacement(frozen()); // the others keep their columns
              lastOver.current = null;
              setDragKey(k);
            }}
            onDragOver={(e) => {
              if (!dragKey || grid) return; // not our drag; grids place by pointer (dragOverGrid)
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              if (lastOver.current === k) return;
              lastOver.current = k;
              moveTo(dragKey, k);
            }}
            onDragLeave={(e) => { if (dragKey && e.target === e.currentTarget && lastOver.current === k) lastOver.current = null; }}
            onDrop={(e) => { if (!dragKey) return; e.preventDefault(); e.stopPropagation(); }}
            onDragEnd={(e) => {
              if (e.target !== e.currentTarget) return;
              setDragKey(null); setArmed(null); lastOver.current = null;
              if (grid) endGridDrag(); else commit(arrange(keys, saved));
            }}>
            <button type="button" className="sort-grip"
              aria-label={`Move ${label} (drag, or arrow keys)${grid ? '; Shift+arrow keys change its width' : ''}`}
              title={grid ? 'Drag to move · arrow keys move it · Shift+←/→ change its width' : 'Drag to reorder'}
              onMouseDown={() => setArmed(k)} onMouseUp={() => !dragKey && setArmed(null)}
              onKeyDown={(e) => onGripKey(e, k, idx, span, it)}>
              <svg viewBox="0 0 10 16" width="8" height="12" aria-hidden="true">
                {[3, 8, 13].map((y) => [2.5, 7.5].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.3" fill="currentColor" />))}
              </svg>
            </button>
            {units ? <div className="sort-body">{it.node}</div> : it.node}
            {units && (naturals[k] ?? 0) > hOf(k) + 2 && (
              <div className="sort-more">
                <button type="button" onClick={() => setExpanded(k)} title="Open the whole widget">⤢ More</button>
              </div>
            )}
            {units && (
              <>
                <div className="sort-resize-y" role="separator" aria-orientation="horizontal"
                  title={`Drag to change the height (${rowsOf(k)} of ${MAX_SPAN} rows) · double-click to fit the content`}
                  onPointerDown={(e) => startResize(e, k, 'y')} onDoubleClick={() => commitRows(k, null)}>
                  {resizing?.key === k && <span className="sort-resize-badge">{resizing.span}× {resizing.rows}×</span>}
                </div>
                {cols > 1 && <div className="sort-resize-xy" title="Drag to resize both ways" onPointerDown={(e) => startResize(e, k, 'xy')} />}
              </>
            )}
            {grid && cols > 1 && (
              <div className="sort-resize" role="separator" aria-orientation="vertical"
                title={`Drag to resize (${span} of ${cols} column${cols === 1 ? '' : 's'}) · double-click to reset`}
                onPointerDown={(e) => startResize(e, k)}
                onDoubleClick={() => commitSize(k, null)}>
                {resizing?.key === k && !units && <span className="sort-resize-badge">{span} / {cols}</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
    {expanded && byKey.get(expanded) && (
      <div className="sort-modal" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) setExpanded(null); }}>
        <div className="sort-modal-card">
          <button type="button" className="sort-modal-x" onClick={() => setExpanded(null)} aria-label="Close" title="Close (Esc)">×</button>
          {byKey.get(expanded)!.node}
        </div>
      </div>
    )}
    </>
  );
}
