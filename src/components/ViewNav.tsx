// The board tabs in the top bar. When every group fits, they show as tabs;
// when the window is too narrow (or team names take the room), each category
// collapses into its own "Leave ▾" menu so no board is ever cut off. A hidden copy
// of the tabs is measured against the space the slot actually has.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Select } from './Select.tsx';
import type { View } from '../state/filters.ts';

export interface ViewGroup { title: string; views: { id: View; label: string }[] }

export function ViewNav({ groups, view, onPick, badge }: {
  groups: ViewGroup[]; view: View; onPick: (v: View) => void;
  /** extra content after a board's label (e.g. a count) */
  badge?: (id: View) => ReactNode;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(false);

  useLayoutEffect(() => {
    const s = slot.current, g = ghost.current;
    if (!s || !g) return;
    const fit = () => setCompact(g.scrollWidth > s.clientWidth + 1);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(s); ro.observe(g);
    return () => ro.disconnect();
  }, []);

  const tabs = (ghostCopy: boolean) => (
    <nav ref={ghostCopy ? ghost : undefined} className={'view-groups' + (ghostCopy ? ' ghost' : '')} aria-label={ghostCopy ? undefined : 'Boards'} aria-hidden={ghostCopy || undefined}>
      {groups.map((g) => (
        <div key={g.title} className="view-group" role="group" aria-label={g.title}>
          <span className="view-group-label">{g.title}</span>
          <div className="seg">
            {g.views.map((v) => (
              <button type="button" key={v.id} tabIndex={ghostCopy ? -1 : undefined} className={'chip' + (view === v.id ? ' on' : '')}
                onClick={ghostCopy ? undefined : () => onPick(v.id)}>{v.label}{badge?.(v.id)}</button>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );

  // compact: one menu per category ("Leave ▾"), the current board's category highlighted;
  // a category with a single board is a plain button
  const menus = (
    <nav className="view-menus" aria-label="Boards">
      {groups.map((g) => {
        const here = g.views.find((v) => v.id === view);
        if (g.views.length === 1) {
          const v = g.views[0];
          return (
            <button key={g.title} type="button" className={'vm-btn' + (here ? ' on' : '')} aria-current={here ? 'page' : undefined}
              title={`${g.title}: ${v.label}`} onClick={() => onPick(v.id)}>
              <span className="vn-grp">{g.title}</span>{here && <b>{v.label}</b>}{badge?.(v.id)}
            </button>
          );
        }
        return (
          <Select<View> key={g.title} value={here?.id ?? ('' as View)} className={'vm-btn' + (here ? ' on' : '')} minWidth={170} title={`${g.title} boards`}
            options={g.views.map((v) => ({ value: v.id, label: <span className="vn-opt">{v.label}{badge?.(v.id)}</span> }))}
            onChange={onPick}
            display={<><span className="vn-grp">{g.title}</span>{here && <b>{here.label}</b>}</>} />
        );
      })}
    </nav>
  );

  return (
    <div ref={slot} className="nav-slot">
      {tabs(true)}
      {compact ? menus : tabs(false)}
    </div>
  );
}
