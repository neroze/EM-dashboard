// Top-bar team header: the viewed team name(s) as the page title — click a
// name to rename it in place — plus a picker to view one team or several at
// once (their people and leave are combined everywhere).
import { useEffect, useRef, useState } from 'react';
import type { Team } from '../types.ts';
import { ColorPicker } from './TeamColor.tsx';

export function TeamHeader({ teams, selected, onSelect, onRename, onAdd, onColor }: {
  teams: Team[];
  selected: string[];
  onSelect: (ids: string[]) => void;
  onRename: (id: string, name: string) => Promise<boolean>;
  onAdd: () => void;
  onColor: (id: string, color: string) => void;
}) {
  const shown = teams.filter((t) => selected.includes(t.id));
  return (
    <div className="team-head" role="group" aria-label="Teams">
      <div className="team-titles">
        {shown.map((t, i) => (
          <span key={t.id} className="team-title-wrap">
            {i > 0 && <span className="team-plus">+</span>}
            <EditableName team={t} onRename={onRename} />
          </span>
        ))}
      </div>
      <TeamPicker teams={teams} selected={selected} onSelect={onSelect} onAdd={onAdd} onColor={onColor} />
    </div>
  );
}

function EditableName({ team, onRename }: { team: Team; onRename: (id: string, name: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(team.name);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [editing]);

  const start = () => { setValue(team.name); setEditing(true); };
  const commit = async () => {
    const v = value.trim();
    if (!v || v === team.name) { setEditing(false); return; }
    setBusy(true);
    const ok = await onRename(team.id, v);
    setBusy(false);
    if (ok) setEditing(false); else input.current?.focus();
  };

  if (editing) {
    return (
      <input ref={input} className="team-title-input" value={value} maxLength={60} disabled={busy}
        size={Math.max(6, value.length + 1)} aria-label="Team name"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void commit(); }
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
        }} />
    );
  }
  return (
    <button type="button" className="team-title" onClick={start} title={`${team.name} — click to rename`}
      style={{ '--tc': team.color } as React.CSSProperties}>
      <i className="team-title-dot" /><span className="team-title-text">{team.name}</span><span className="team-edit" aria-hidden="true">✎</span>
    </button>
  );
}

function TeamPicker({ teams, selected, onSelect, onAdd, onColor }: {
  teams: Team[]; selected: string[]; onSelect: (ids: string[]) => void; onAdd: () => void; onColor: (id: string, color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [coloring, setColoring] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>(selected);
  const ref = useRef<HTMLDivElement>(null);

  const close = (apply: boolean) => {
    setOpen(false);
    if (apply && draft.length && draft.join() !== selected.join()) onSelect(draft);
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(true); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }); // re-bound each render so `close` sees the current draft

  const toggle = (id: string) => setDraft((d) => (d.includes(id) ? (d.length > 1 ? d.filter((x) => x !== id) : d) : [...d, id]));

  return (
    <div className="team-picker" ref={ref}>
      <button type="button" className={'team-pick-btn' + (open ? ' open' : '')} aria-expanded={open} aria-haspopup="dialog"
        onClick={() => (open ? close(true) : (setDraft(selected), setOpen(true)))}
        title={`Viewing ${teams.filter((t) => selected.includes(t.id)).map((t) => t.name).join(' + ')} · choose teams`} aria-label="Choose teams">
        {selected.length > 1 && <span className="team-count">{selected.length}</span>}
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="team-pop">
          <div className="team-pop-h">Show teams</div>
          {teams.map((t) => (
            <div key={t.id}>
              <div className="team-row">
                <label>
                  <input type="checkbox" checked={draft.includes(t.id)} onChange={() => toggle(t.id)}
                    disabled={draft.length === 1 && draft.includes(t.id)} />
                  <span>{t.name}</span>
                </label>
                <button type="button" className="team-color-btn" style={{ background: t.color }} title="Change colour"
                  aria-label={`Colour of ${t.name}`} onClick={() => setColoring(coloring === t.id ? null : t.id)} />
                <button type="button" className="link small" onClick={() => { setDraft([t.id]); setOpen(false); onSelect([t.id]); }}>only</button>
              </div>
              {coloring === t.id && (
                <div className="team-color-row"><ColorPicker value={t.color} onChange={(c) => onColor(t.id, c)} /></div>
              )}
            </div>
          ))}
          <div className="team-pop-actions">
            <button type="button" className="link small" onClick={() => { setOpen(false); onAdd(); }}>＋ Add team</button>
            <div className="spacer" />
            {teams.length > 1 && draft.length < teams.length && (
              <button type="button" className="link small" onClick={() => setDraft(teams.map((t) => t.id))}>All</button>
            )}
            <button type="button" className="primary small-btn" onClick={() => close(true)}
              disabled={draft.join() === selected.join()}>View</button>
          </div>
        </div>
      )}
    </div>
  );
}
