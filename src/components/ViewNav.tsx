// The board tabs in the top bar. When every group fits, they show as tabs;
// when the window is too narrow (or team names take the room), they collapse
// into one "Group · Board ▾" menu so no board is ever cut off. A hidden copy
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

  const cur = groups.flatMap((g) => g.views.map((v) => ({ g, v }))).find((x) => x.v.id === view);
  const options = groups.flatMap((g) => g.views.map((v) => ({
    value: v.id,
    label: <span className="vn-opt"><span className="vn-grp">{g.title}</span>{v.label}{badge?.(v.id)}</span>,
  })));

  return (
    <div ref={slot} className="nav-slot">
      {tabs(true)}
      {compact
        ? <Select<View> value={view} options={options} onChange={onPick} className="vn-btn" minWidth={220} title="Switch board"
            display={<><span className="vn-grp">{cur?.g.title}</span><b>{cur?.v.label}</b></>} />
        : tabs(false)}
    </div>
  );
}
