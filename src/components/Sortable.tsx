// Drag-and-drop reorderable grid. Each item gets a grip (shown on hover);
// dragging it reorders live, arrow keys on the focused grip move it too. The
// order is saved per `id` in localStorage (a per-viewer convenience — when
// storage is unavailable it simply isn't remembered). New items the saved
// order doesn't know yet are appended in their default position.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { LAYOUT_RESET_EVENT, loadLayout, saveLayout } from '../state/layout.ts';

export interface SortItem { key: string; node: ReactNode; className?: string }

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

export function Sortable({ id, items, className, label = 'widget' }: {
  id: string; items: SortItem[]; className?: string; label?: string;
}) {
  const keys = items.map((i) => i.key);
  const [saved, setSaved] = useState<string[]>(() => loadLayout(id));
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null); // grip pressed: that item may start a drag
  const lastOver = useRef<string | null>(null);
  const order = arrange(keys, saved);

  useEffect(() => {
    const onReset = () => setSaved([]);
    window.addEventListener(LAYOUT_RESET_EVENT, onReset);
    return () => window.removeEventListener(LAYOUT_RESET_EVENT, onReset);
  }, []);

  const commit = useCallback((next: string[]) => { setSaved(next); saveLayout(id, next); }, [id]);

  const moveTo = (key: string, target: string) => {
    if (key === target) return;
    const cur = arrange(keys, saved);
    const from = cur.indexOf(key), to = cur.indexOf(target);
    cur.splice(from, 1);
    cur.splice(to, 0, key);
    setSaved(cur);
  };

  const byKey = new Map(items.map((i) => [i.key, i]));
  return (
    <div className={className}>
      {order.map((k, idx) => {
        const it = byKey.get(k)!;
        return (
          <div key={k} className={'sort-item' + (it.className ? ' ' + it.className : '') + (dragKey === k ? ' dragging' : '') + (dragKey && dragKey !== k ? ' drop-ok' : '')}
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
              lastOver.current = k;
              moveTo(dragKey, k);
            }}
            onDragLeave={(e) => { if (dragKey && e.target === e.currentTarget && lastOver.current === k) lastOver.current = null; }}
            onDrop={(e) => { if (!dragKey) return; e.preventDefault(); e.stopPropagation(); }}
            onDragEnd={(e) => {
              if (e.target !== e.currentTarget) return;
              setDragKey(null); setArmed(null); lastOver.current = null;
              commit(arrange(keys, saved));
            }}>
            <button type="button" className="sort-grip" aria-label={`Move ${label} (drag, or use arrow keys)`} title="Drag to reorder"
              onMouseDown={() => setArmed(k)} onMouseUp={() => !dragKey && setArmed(null)}
              onKeyDown={(e) => {
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
          </div>
        );
      })}
    </div>
  );
}
