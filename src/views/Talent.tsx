// Talent Grid: an engineering manager calibrates their direct reports on a
// 3×3 (default) or 4×4 performance × potential matrix. Ratings live in the
// backend (<data>/talent.json); every box, band and average is derived here
// from backend/domain/talent.ts, so a placement is always explainable.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode, type RefObject } from 'react';
import { api, type TalentState } from '../api.ts';
import {
  BANDS, boxesInMatrixOrder, boxRangeText, CRITERIA, fmtAvg, isLevel, LEVELS, levelLabel, levelShort, parseBox, place, rangeText,
  zoneInfo, zoneOf, ZONES, type Cause, type Layout, type Level, type Placement, type Ratings, type RosterPerson, type TalentEmployee,
} from '../../backend/domain/talent.ts';
import { CONFLICT, TalentForm } from './TalentForm.tsx';
import { TeamGroup } from '../components/TeamColor.tsx';
import { useTeamGroups } from '../teamColors.ts';
import { TalentSettings } from './TalentSettings.tsx';

type Sort = 'name' | 'box' | 'perf';
type Show = 'all' | 'rated' | 'todo';
type Placed = TalentEmployee & { p: Placement; team: string };
type Row = { kind: 'rated'; e: Placed } | { kind: 'todo'; r: RosterPerson };
interface Toast { text: string; undo?: { id: string; name: string; previous: Ratings; layout: Layout; from: string; to: string }; retry?: () => void }

const errText = (e: unknown) => String((e as any)?.message ?? e).replace(/^Error:\s*/, '');
const CAUSE: Record<Cause, string> = { created: 'Created', edited: 'Edited', moved: 'Moved', undone: 'Move undone', imported: 'Imported', reweighted: 'Weights changed' };
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// ---- density: a per-viewer convenience, so browser storage (it may be unavailable) ----
export type Density = 'compact' | 'comfort';
const DENSITY_KEY = 'talent.density';
function readDensity(): Density { try { return localStorage.getItem(DENSITY_KEY) === 'comfort' ? 'comfort' : 'compact'; } catch { return 'compact'; } }
function keepDensity(d: Density) { try { localStorage.setItem(DENSITY_KEY, d); } catch { /* not remembered */ } }

// ---- hash: layout + level filter travel with a shared link (FR-13, FR-19) ----
function readHash(): { layout: Layout | null; level: Level | '' } {
  const p = new URLSearchParams(location.hash.slice(1));
  const g = p.get('tg'), l = p.get('tl');
  return { layout: g === '4' ? 4 : g === '3' ? 3 : null, level: isLevel(l) ? l : '' };
}
function writeHash(layout: Layout, level: Level | '') {
  const p = new URLSearchParams(location.hash.slice(1));
  p.set('tg', String(layout));
  if (level) p.set('tl', level); else p.delete('tl');
  const h = '#' + p.toString();
  if (location.hash !== h) history.replaceState(null, '', h);
}

/** `version` bumps after every BambooHR sync: the team may have changed */
export function TalentBoard({ version }: { version: number }) {
  const [data, setData] = useState<TalentState | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [layout, setLayoutState] = useState<Layout>(() => readHash().layout ?? 3);
  const [level, setLevel] = useState<Level | ''>(() => readHash().level);
  const [boxFilter, setBoxFilter] = useState('');
  /** the team modal: null = closed; `show` picks who is listed */
  const [teamModal, setTeamModal] = useState<{ show: Show } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverBox, setHoverBox] = useState('');
  const [form, setForm] = useState<{ employee: TalentEmployee | null; person: RosterPerson | null } | null>(null);
  const [settingsTab, setSettingsTab] = useState<'' | 'grid' | 'weights' | 'export' | 'import'>('');
  const [moveFor, setMoveFor] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [announce, setAnnounce] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropBox, setDropBox] = useState('');
  /** the box opened in the box detail modal */
  const [openBox, setOpenBox] = useState<string | null>(null);
  /** box height fitted to the window (null = natural height, on narrow screens) */
  const [boxH, setBoxH] = useState<number | null>(null);
  /** boxes whose people don't fit: they get a "More" button, like the widgets on other boards */
  const [over, setOver] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [density, setDensityState] = useState<Density>(readDensity);
  const setDensity = useCallback((d: Density) => { setDensityState(d); keepDensity(d); }, []);
  const hashLayout = useRef(readHash().layout);

  const load = useCallback(async () => {
    try {
      const d = await api.getTalent();
      setData(d); setLoadErr('');
      return d;
    } catch (e) { setLoadErr(errText(e)); return null; }
  }, []);

  useEffect(() => {
    void load().then((d) => {
      // a shared link opens in its own layout; otherwise the last one used
      if (d && !hashLayout.current) setLayoutState(d.layout);
    });
  }, [load]);
  const firstVersion = useRef(version);
  useEffect(() => { if (version !== firstVersion.current) void load(); }, [version, load]);

  useEffect(() => { writeHash(layout, level); }, [layout, level]);

  const say = useCallback((t: Toast) => { setToast(t); setAnnounce(t.text); }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 10_000 : toast.retry ? 8000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const switchLayout = useCallback(async (l: Layout) => {
    if (l === layout) return;
    setLayoutState(l); setBoxFilter(''); setHoverBox('');
    say({ text: `Showing ${l}×${l} grid. Scores unchanged.` });
    try { await api.setTalentLayout(l); } catch { /* the choice still applies now; it is just not remembered */ }
  }, [layout, say]);

  // ---- derived -------------------------------------------------------------
  // the grid is the selected BambooHR team(s): rated members are placed, the rest wait to be rated;
  // records of people no longer in those teams are kept (never deleted automatically) but set aside
  const rosterById = useMemo(() => new Map((data?.roster ?? []).map((r) => [r.bambooId, r])), [data]);
  const placed: Placed[] = useMemo(() => (data?.employees ?? []).filter((e) => e.bambooId && rosterById.has(e.bambooId))
    .map((e) => ({ ...e, p: place(e.ratings, data!.weights[e.level], layout), team: rosterById.get(e.bambooId!)!.team })), [data, layout, rosterById]);
  const outside = useMemo(() => (data?.employees ?? []).filter((e) => !e.bambooId || !rosterById.has(e.bambooId)).sort((a, b) => a.name.localeCompare(b.name)), [data, rosterById]);
  const unrated = useMemo(() => {
    const rated = new Set((data?.employees ?? []).map((e) => e.bambooId).filter(Boolean));
    return (data?.roster ?? []).filter((r) => !rated.has(r.bambooId)).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);
  const levelCounts = useMemo(() => Object.fromEntries(LEVELS.map((l) => [l.id, placed.filter((e) => e.level === l.id).length])) as Record<Level, number>, [placed]);
  const team = useMemo(() => (level ? placed.filter((e) => e.level === level) : placed), [placed, level]);
  const byBox = useMemo(() => {
    const m = new Map<string, Placed[]>();
    for (const b of boxesInMatrixOrder(layout)) m.set(b, []);
    for (const e of team) m.get(e.p.box)!.push(e);
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [team, layout]);
  const current = selected ? placed.find((e) => e.id === selected) ?? null : null;
  /** open the team list, optionally on one box's people */
  const openTeam = useCallback((show: Show, box = '') => { setBoxFilter(box); setTeamModal({ show }); }, []);
  const closeTeam = useCallback(() => { setTeamModal(null); setBoxFilter(''); }, []);

  // ---- moves (FR-20 – FR-23) -------------------------------------------------
  const requestMove = useCallback(async (id: string, box: string) => {
    if (!data) return;
    const e = placed.find((x) => x.id === id);
    if (!e || e.p.box === box) return;
    const to = parseBox(layout, box)!;
    const axes = [e.p.perfIdx !== to.perfIdx && `performance ratings so they average into ${BANDS[layout][to.perfIdx].name} (${rangeText(layout, to.perfIdx)})`,
      e.p.potIdx !== to.potIdx && `potential ratings so they average into ${BANDS[layout][to.potIdx].name} (${rangeText(layout, to.potIdx)})`].filter(Boolean);
    const ok = await tiny.dialog.confirm(`Move ${e.name} from ${e.p.box} ${data.copy[layout][e.p.box].title} to ${box} ${data.copy[layout][box].title}?`, {
      detail: `Their ${axes.join(' and their ')} will be adjusted. ${axes.length === 1 ? 'The other axis stays as it is. ' : ''}You can undo for 10 seconds.`,
      ok: 'Move', cancel: 'Cancel',
    });
    if (!ok) return;
    try {
      const r = await api.moveTalentEmployee(id, e.rev, layout, box);
      await load();
      say({ text: `Moved ${e.name} from ${r.from} to ${r.to}.`, undo: { id, name: e.name, previous: r.previous, layout, from: r.from, to: r.to } });
    } catch (x) {
      const msg = errText(x);
      await load();
      say({ text: CONFLICT.test(msg) ? msg : `Could not move ${e.name}: ${msg}`, retry: CONFLICT.test(msg) ? undefined : () => void again.current.requestMove(id, box) });
    }
  }, [data, placed, layout, load, say]);

  const undo = useCallback(async (u: NonNullable<Toast['undo']>) => {
    const e = data?.employees.find((x) => x.id === u.id);
    if (!e) return;
    setToast(null);
    try {
      await api.undoTalentMove(u.id, e.rev, u.previous, u.layout);
      await load();
      say({ text: `Undone: ${u.name} is back in ${u.from}.` });
    } catch (x) { await load(); say({ text: 'Could not undo: ' + errText(x), retry: () => void again.current.undo(u) }); }
  }, [data, load, say]);

  const remove = useCallback(async (e: TalentEmployee) => {
    const ok = await tiny.dialog.confirm(`Delete ${e.name}?`, {
      detail: `${e.name} and all of their ratings, notes and history are permanently deleted. This cannot be undone.`, ok: 'Delete', cancel: 'Cancel',
    });
    if (!ok) return;
    try {
      await api.deleteTalentEmployee(e.id);
      setSelected(null);
      await load();
      say({ text: `Deleted ${e.name}` });
    } catch (x) { say({ text: 'Could not delete: ' + errText(x), retry: () => void again.current.remove(e) }); }
  }, [load, say]);

  // Retry buttons call the latest version of each action
  const again = useRef({ requestMove, undo, remove });
  useEffect(() => { again.current = { requestMove, undo, remove }; }, [requestMove, undo, remove]);

  // ---- drag and drop -------------------------------------------------------
  const onDragStart = (ev: DragEvent, id: string) => { ev.dataTransfer.setData('text/plain', id); ev.dataTransfer.effectAllowed = 'move'; setDragId(id); };
  const onDragEnd = () => { setDragId(null); setDropBox(''); };
  const onDrop = (ev: DragEvent, box: string) => {
    ev.preventDefault();
    const id = ev.dataTransfer.getData('text/plain') || dragId;
    setDropBox(''); setDragId(null);
    if (id) void requestMove(id, box);
  };

  // ---- fit the rows to the window --------------------------------------------
  // The rows share the height left below the summary, after the column labels and
  // the recommendations panel, so the whole grid is in view without scrolling.
  const fit = useCallback(() => {
    const root = rootRef.current, grid = gridRef.current;
    if (!root || !grid) return;
    if (root.clientWidth < 640) { setBoxH(null); return; } // phones: counts only, natural height
    const rows = grid.querySelectorAll<HTMLElement>(':scope > .tg-row:not(.tg-colheads)');
    const main = root.querySelector<HTMLElement>('.tg-main');
    if (!rows.length || !main) return;
    const rootTop = root.getBoundingClientRect().top - root.scrollTop;
    const first = rows[0].getBoundingClientRect(), last = rows[rows.length - 1].getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(grid).rowGap) || 6;
    const below = main.getBoundingClientRect().bottom - last.bottom; // column labels, axis label, panel
    const avail = root.clientHeight - (first.top - rootTop) - below - 6;
    const min = density === 'comfort' ? 120 : 84;
    const h = Math.max(min, Math.floor((avail - gap * (rows.length - 1)) / rows.length));
    setBoxH((cur) => (cur === h ? cur : h));
  }, [density]);
  useLayoutEffect(() => {
    fit();
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(root);
    return () => ro.disconnect();
  }, [fit, data, layout]);
  // which boxes overflow (measured after every render; only a change re-renders)
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const list = [...grid.querySelectorAll<HTMLElement>('.tg-box')]
      .filter((b) => { const ul = b.querySelector<HTMLElement>('.tg-box-people'); return !!ul && ul.scrollHeight > ul.clientHeight + 1; })
      .map((b) => b.dataset.box).join(',');
    if (list !== over) setOver(list);
  });

  // ---- render ----------------------------------------------------------------
  if (loadErr && !data) return <div className="empty">Could not open the Talent Grid: {loadErr} <button type="button" className="link" onClick={() => void load()}>Retry</button></div>;
  if (!data) return <div className="empty">Loading…</div>;

  const overSet = new Set(over.split(',').filter(Boolean));
  const shownBox = hoverBox || boxFilter;
  const total = team.length;
  const zoneCounts = ZONES.map((z) => ({ ...z, n: team.filter((e) => zoneOf(layout, e.p.box) === z.id).length }));
  const rows = Array.from({ length: layout }, (_, pot) => pot);

  return (
    <div ref={rootRef} className={'tg' + (density === 'comfort' ? ' comfort' : '')}>
      <div className="sr-only" aria-live="polite" role="status">{announce}</div>

      <div className="tg-bar">
        <h2 className="tg-title">Talent Grid</h2>
        <div className="seg tg-levels" role="group" aria-label="Filter by job level">
          <button type="button" className={'chip' + (!level ? ' on' : '')} aria-pressed={!level} onClick={() => setLevel('')}>All <span className="muted">{placed.length}</span></button>
          {LEVELS.map((l) => (
            <button key={l.id} type="button" className={'chip' + (level === l.id ? ' on' : '')} aria-pressed={level === l.id} title={l.label}
              onClick={() => { setLevel(level === l.id ? '' : l.id); setBoxFilter(''); }}>
              <span className="tg-lvl-long">{l.label}</span><span className="tg-lvl-short">{l.short}</span> <span className="muted">{levelCounts[l.id]}</span>
            </button>
          ))}
        </div>
        {level && <button type="button" className="link" onClick={() => setLevel('')}>Clear filter</button>}
        <div className="spacer" />
        <div className="seg tg-layout-seg" role="group" aria-label="Grid size">
          {([3, 4] as Layout[]).map((n) => (
            <button key={n} type="button" className={'chip' + (layout === n ? ' on' : '')} aria-pressed={layout === n}
              title={n === 3 ? '3×3: High · Medium · Low' : '4×4: Exceptional · High · Moderate · Low'} onClick={() => void switchLayout(n)}>{n}×{n}</button>
          ))}
        </div>
        <div className="seg tg-density-seg" role="group" aria-label="Density">
          {(['compact', 'comfort'] as Density[]).map((d) => (
            <button key={d} type="button" className={'chip' + (density === d ? ' on' : '')} aria-pressed={density === d}
              title={d === 'compact' ? 'Compact: more on screen' : 'Comfort: larger boxes, text and spacing, with box descriptions'}
              onClick={() => setDensity(d)}>{d === 'compact' ? 'Compact' : 'Comfort'}</button>
          ))}
        </div>
        <button type="button" className="primary" onClick={() => openTeam(unrated.length ? 'todo' : 'all')}
          title="Your BambooHR team: add people to the grid, find anyone already on it">
          + Add from team{unrated.length > 0 && <span className="tg-btn-badge">{unrated.length}</span>}</button>
        <button type="button" onClick={() => setSettingsTab('grid')} aria-label="Talent Grid settings" title="Grid, weights, export, import">⚙ Settings</button>
      </div>

      {/* FR-10: distribution by zone */}
      <div className="tg-dist" aria-label="Team distribution by zone">
        <div className="tg-dist-head">
          <span className="card-n">{total}<small> {total === 1 ? 'person' : 'people'}{level ? ` · ${levelLabel(level)}` : ''}</small></span>
          <button type="button" className="link small tg-rated-link" onClick={() => openTeam(unrated.length ? 'todo' : 'all')}>
            {placed.length} of {data.roster.length} in your team on the grid</button>
        </div>
        <div className="tg-stack" role="img" aria-label={zoneCounts.map((z) => `${z.label} ${z.n} (${pct(z.n, total)}%)`).join(', ')}>
          {total ? zoneCounts.filter((z) => z.n).map((z) => <span key={z.id} className={'z-' + z.id} style={{ flexGrow: z.n }} title={`${z.label}: ${z.n}`} />) : <span className="tg-stack-empty" />}
        </div>
        <ul className="tg-dist-legend">
          {zoneCounts.map((z) => (
            <li key={z.id}><span className={'tg-swatch z-' + z.id} aria-hidden="true" /><b>{z.label}</b> {z.n} <span className="muted">· {pct(z.n, total)}%</span></li>
          ))}
        </ul>
      </div>

      {data.roster.length === 0 && placed.length === 0 ? (
        <div className="empty tg-empty">
          <h3>No one in the selected team</h3>
          <p>The grid lists the people in your BambooHR team. Sync now, or pick a team in the header.</p>
          <button type="button" onClick={() => setSettingsTab('import')}>Import a backup</button>
        </div>
      ) : (
        <div className="tg-main">
            <div className={`tg-matrix g${layout}${boxH ? ' fitted' : ''}`}>
              <div className="tg-ylabel" aria-hidden="true">Potential →</div>
              <div ref={gridRef} className="tg-grid" role="grid" aria-label={`${layout}×${layout} talent matrix: performance left to right, potential bottom to top`}>
              {rows.map((pot) => (
                <div key={pot} className="tg-row" role="row" style={boxH ? { height: boxH } : undefined}>
                  <div className="tg-rowhead" role="rowheader"><span>{BANDS[layout][pot].name}</span><span className="muted">({pot + 1})</span></div>
                  {Array.from({ length: layout }, (_, i) => layout - 1 - i).map((perf) => {
                    const box = String.fromCharCode(65 + perf) + (pot + 1);
                    const people = byBox.get(box) ?? [];
                    const c = data.copy[layout][box];
                    const zone = zoneOf(layout, box);
                    const range = boxRangeText(layout, box);
                    return (
                      <div key={box} role="gridcell" tabIndex={0} data-box={box}
                        className={`tg-box z-${zone}${boxFilter === box ? ' on' : ''}${dropBox === box ? ' drop' : ''}`}
                        aria-label={`${box} ${c.title}, ${people.length} ${people.length === 1 ? 'person' : 'people'}, ${zoneInfo(zone).label}. ${range}`}
                        onMouseEnter={() => setHoverBox(box)} onMouseLeave={() => setHoverBox('')}
                        onFocus={(ev) => { if (ev.target === ev.currentTarget) setHoverBox(box); }} onBlur={() => setHoverBox('')}
                        onClick={(ev) => { if (ev.target === ev.currentTarget || (ev.target as HTMLElement).closest('.tg-box-head')) setOpenBox(box); }}
                        onKeyDown={(ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === ev.currentTarget) { ev.preventDefault(); setOpenBox(box); } }}
                        onDragOver={(ev) => { if (dragId) { ev.preventDefault(); setDropBox(box); } }}
                        onDragLeave={() => setDropBox((d) => (d === box ? '' : d))}
                        onDrop={(ev) => onDrop(ev, box)}>
                        <div className="tg-box-head">
                          <span className="tg-box-tag" title={range}>{box}</span>
                          <span className="tg-box-title">{c.title}</span>
                          <span className="tg-box-n">{people.length}<span className="muted"> · {pct(people.length, total)}%</span></span>
                        </div>
                        {density === 'comfort' && <p className="tg-box-desc">{c.description}</p>}
                        <ul className="tg-box-people">
                          {people.map((e) => (
                            <li key={e.id}>
                              <button type="button" className={'tg-chip' + (selected === e.id ? ' sel' : '')} draggable
                                onDragStart={(ev) => onDragStart(ev, e.id)} onDragEnd={onDragEnd}
                                onClick={() => setSelected(e.id)} title={`${e.name} · ${levelLabel(e.level)} — drag to another box to move`}>
                                {e.name} <span className="muted">{levelShort(e.level)}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                        {overSet.has(box) && (
                          <div className="tg-box-more">
                            <button type="button" onClick={() => setOpenBox(box)} title={`Open ${box} ${c.title}: everyone in it and what to do`}>⤢ More</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
              <div className="tg-row tg-colheads" aria-hidden="true">
                <div className="tg-rowhead" />
                {Array.from({ length: layout }, (_, i) => layout - 1 - i).map((perf) => (
                  <div key={perf} className="tg-colhead">{BANDS[layout][perf].name} ({String.fromCharCode(65 + perf)})</div>
                ))}
              </div>
              <div className="tg-xlabel" aria-hidden="true">Performance →</div>
              </div>
            </div>

            {/* FR-11 + §7.1.3: fixed panel, so hovering never makes the page jump */}
            <div className="tg-rec" aria-live="polite">
              {shownBox ? (() => {
                const c = data.copy[layout][shownBox];
                const z = zoneInfo(zoneOf(layout, shownBox));
                return (
                  <>
                    <div className="tg-rec-head">
                      <span className={'tg-box-tag z-' + z.id}>{shownBox}</span>
                      <b>{c.title}</b>
                      <span className="muted small">{boxRangeText(layout, shownBox)}</span>
                    </div>
                    <p className="small">{c.description} <span className="muted">· {z.label}: {z.meaning}</span></p>
                    <ol className="small">{c.actions.slice(0, 3).map((a) => <li key={a}>{a}</li>)}</ol>
                  </>
                );
              })() : <p className="muted small">Hover over or focus a box to see what it takes and the recommended next steps. Click a box for everyone in it and all its actions. Drag a name to another box, or use Move to box… on their details, to move someone.</p>}
            </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast.text}
          {toast.undo && <button type="button" className="link" onClick={() => void undo(toast.undo!)}>Undo</button>}
          {toast.retry && <button type="button" className="link" onClick={() => { const r = toast.retry!; setToast(null); r(); }}>Retry</button>}
        </div>
      )}

      {teamModal && (
        <TeamModal data={data} layout={layout} level={level} placed={placed} unrated={unrated} outside={outside}
          initialShow={teamModal.show} box={boxFilter} onClearBox={() => setBoxFilter('')} onClose={closeTeam}
          onOpen={(id) => setSelected(id)} onRate={(r) => setForm({ employee: null, person: r })}
          onMove={(id) => setMoveFor(id)} onDelete={(e) => void remove(e)} />
      )}
      {openBox && (
        <BoxModal box={openBox} layout={layout} data={data} total={total} people={byBox.get(openBox) ?? []} level={level}
          onClose={() => setOpenBox(null)} onOpen={(id) => setSelected(id)} onMove={(id) => setMoveFor(id)} />
      )}
      {current && (
        <ModalSheet label={current.name} onClose={() => setSelected(null)}>
          <Detail e={current} data={data} layout={layout}
            onBack={() => setSelected(null)} onEdit={() => setForm({ employee: current, person: null })}
            onDelete={() => void remove(current)} onMove={() => setMoveFor(current.id)} />
        </ModalSheet>
      )}
      {form && (
        <TalentForm data={data} layout={layout} employee={form.employee} person={form.person}
          onClose={() => setForm(null)}
          onConflict={async () => { const d = await load(); return d?.employees.find((x) => x.id === form.employee?.id) ?? null; }}
          onSaved={async (e, created) => {
            setForm(null);
            const d = await load();
            const box = d ? place(e.ratings, d.weights[e.level], layout).box : '';
            say({ text: created ? `Added ${e.name} to the grid${box ? ` in ${box}` : ''}` : `Saved ${e.name}` });
          }} />
      )}
      {settingsTab && (
        <TalentSettings data={data} layout={layout} initialTab={settingsTab} onLayout={(l) => void switchLayout(l)}
          density={density} onDensity={setDensity}
          onClose={() => setSettingsTab('')} onChanged={async () => { await load(); }} toast={(text) => say({ text })} />
      )}
      {moveFor && (() => {
        const e = placed.find((x) => x.id === moveFor);
        return e ? <MoveDialog e={e} layout={layout} data={data} onClose={() => setMoveFor(null)}
          onPick={(box) => { setMoveFor(null); void requestMove(e.id, box); }} /> : null;
      })()}
    </div>
  );
}

/** FR-24/25: one person's full picture */
function Detail({ e, data, layout, onBack, onEdit, onDelete, onMove }: {
  e: Placed; data: TalentState; layout: Layout; onBack: () => void; onEdit: () => void; onDelete: () => void; onMove: () => void;
}) {
  const c = data.copy[layout][e.p.box];
  const z = zoneInfo(zoneOf(layout, e.p.box));
  const w = data.weights[e.level];
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => { back.current?.focus(); }, [e.id]);
  return (
    <div className="tg-detail">
      <div className="tg-detail-bar">
        <button ref={back} type="button" onClick={onBack}>Close</button>
        <div className="spacer" />
        <button type="button" onClick={onMove}>Move to box…</button>
        <button type="button" onClick={onEdit}>Edit</button>
        <button type="button" className="danger" onClick={onDelete}>Delete</button>
      </div>
      <h3>{e.name}</h3>
      <p className="muted small">{[e.role, levelLabel(e.level), e.team].filter(Boolean).join(' · ')}</p>
      <div className={'tg-preview z-' + z.id}>
        <span className="tg-box-tag">{e.p.box}</span>
        <div>
          <b>{c.title}</b> <span className="muted small">· {z.label}</span>
          <div className="small">{c.description}</div>
        </div>
      </div>
      <div className="tg-avgs">
        <div><span className="muted small">Performance</span><b>{fmtAvg(e.p.perf)}</b><span className="small">{BANDS[layout][e.p.perfIdx].name}</span></div>
        <div><span className="muted small">Potential</span><b>{fmtAvg(e.p.pot)}</b><span className="small">{BANDS[layout][e.p.potIdx].name}</span></div>
      </div>
      <table className="tg-ratings">
        <thead><tr><th scope="col">Criterion</th><th scope="col">Rating</th><th scope="col">Weight</th></tr></thead>
        <tbody>
          {CRITERIA.map((cr, i) => (
            <tr key={cr.id} className={i === 5 ? 'axis-break' : ''}>
              <th scope="row" title={cr.hint}>{cr.label}</th>
              <td><span className="tg-dots" aria-label={`${e.ratings[cr.id]} of 5`}>{[1, 2, 3, 4, 5].map((v) => <span key={v} className={v <= e.ratings[cr.id] ? 'on' : ''} />)}</span> {e.ratings[cr.id]}</td>
              <td className="muted">{w[cr.id]}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      {e.notes && (<><h4>Notes</h4><p className="tg-notes">{e.notes}</p></>)}
      <h4>Recommended actions</h4>
      <ol className="small">{c.actions.map((a) => <li key={a}>{a}</li>)}</ol>
      <h4>History</h4>
      <ol className="tg-history">
        {[...e.history].reverse().map((h, i) => (
          <li key={h.at + i}>
            <div><b>{CAUSE[h.cause]}</b>{h.from && h.to ? ` ${h.from} → ${h.to}` : ''} <span className="muted small">· {fmtWhen(h.at)}{h.by ? ` · ${h.by}` : ''}</span></div>
            <div className="small">
              <span className={'tg-box-tag sm z-' + zoneOf(h.layout, h.box)}>{h.box}</span> {data.copy[h.layout][h.box]?.title} <span className="muted">({h.layout}×{h.layout})</span>
              {' · '}Perf {fmtAvg(h.perf)} · Pot {fmtAvg(h.pot)}
            </div>
            <details className="small muted">
              <summary>Ratings and weights</summary>
              {levelLabel(h.level)}: {CRITERIA.map((cr) => `${cr.label} ${h.ratings[cr.id]} × ${h.weights[cr.id]}%`).join(' · ')}
            </details>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** keyboard-friendly alternative to drag and drop (§7.3) */
function MoveDialog({ e, layout, data, onClose, onPick }: { e: Placed; layout: Layout; data: TalentState; onClose: () => void; onPick: (box: string) => void }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const firstBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstBtn.current?.focus();
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, []);
  const boxes = boxesInMatrixOrder(layout);
  const firstOther = boxes.find((b) => b !== e.p.box);
  return (
    <div className="sheet-backdrop" onMouseDown={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div className="sheet tg-sheet" role="dialog" aria-modal="true" aria-labelledby="tg-move-title">
        <header className="sheet-head">
          <h2 id="tg-move-title">Move {e.name} to box…</h2>
          <div className="spacer" />
          <button type="button" onClick={onClose}>Cancel</button>
        </header>
        <p className="muted small">Now in {e.p.box} {data.copy[layout][e.p.box].title}. Ratings on the axis that changes are adjusted to fit the new box; you can undo.</p>
        <div className={`tg-move-grid g${layout}`}>
          {boxes.map((b) => (
            <button key={b} ref={b === firstOther ? firstBtn : undefined} type="button" className={'tg-move-opt z-' + zoneOf(layout, b)} disabled={b === e.p.box}
              onClick={() => onPick(b)} title={boxRangeText(layout, b)}>
              <span className="tg-box-tag">{b}</span> {data.copy[layout][b].title}{b === e.p.box ? ' (current)' : ''}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** close on Escape only when this sheet is the topmost one (sheets stack: team → details → form) */
function useTopEscape(ref: RefObject<HTMLDivElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const esc = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      const all = document.querySelectorAll('.sheet-backdrop');
      if (all[all.length - 1] === ref.current) closeRef.current();
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [ref]);
}

function ModalSheet({ label, onClose, children, wide }: { label: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useTopEscape(ref, onClose);
  return (
    <div ref={ref} className="sheet-backdrop" onMouseDown={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div className={'sheet tg-sheet tg-modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={label}>{children}</div>
    </div>
  );
}

const SORTS: Record<Sort, (a: Placed, b: Placed) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  box: (a, b) => a.p.box.localeCompare(b.p.box) || a.name.localeCompare(b.name),
  perf: (a, b) => b.p.perf - a.p.perf || b.p.pot - a.p.pot || a.name.localeCompare(b.name),
};

/** the BambooHR team in a modal (FR-16 – FR-18): grouped by team; add people to the grid, find anyone on it */
function TeamModal({ data, layout, level, placed, unrated, outside, initialShow, box, onClearBox, onClose, onOpen, onRate, onMove, onDelete }: {
  data: TalentState; layout: Layout; level: Level | ''; placed: Placed[]; unrated: RosterPerson[]; outside: TalentEmployee[];
  initialShow: Show; box: string; onClearBox: () => void; onClose: () => void;
  onOpen: (id: string) => void; onRate: (r: RosterPerson) => void; onMove: (id: string) => void; onDelete: (e: TalentEmployee) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useTopEscape(ref, onClose);
  useEffect(() => { search.current?.focus(); }, []);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [show, setShow] = useState<Show>(box ? 'rated' : initialShow);

  const needle = q.trim().toLowerCase();
  const hit = (name: string, role = '') => !needle || name.toLowerCase().includes(needle) || role.toLowerCase().includes(needle);
  // unrated people have no level or box yet, so those filters hide them
  const narrowed = !!box || !!level;
  const rated = show === 'todo' ? [] : placed.filter((e) => (!level || e.level === level) && (!box || e.p.box === box) && hit(e.name, e.role)).sort(SORTS[sort]);
  const todo = show === 'rated' || narrowed ? [] : unrated.filter((r) => hit(r.name));
  const groups = useTeamGroups<Row>([...rated.map((e): Row => ({ kind: 'rated', e })), ...todo.map((r): Row => ({ kind: 'todo', r }))],
    (x) => (x.kind === 'rated' ? x.e.team : x.r.team));
  const onGrid = placed.filter((e) => !level || e.level === level).length;
  const tabs: [Show, string, number][] = [
    ['all', 'All', onGrid + (narrowed ? 0 : unrated.length)], ['todo', 'Not on the grid', unrated.length], ['rated', 'On the grid', onGrid],
  ];

  return (
    <div ref={ref} className="sheet-backdrop" onMouseDown={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div className="sheet wide tg-sheet tg-modal" role="dialog" aria-modal="true" aria-labelledby="tg-team-title">
        <header className="sheet-head">
          <h2 id="tg-team-title">Your team</h2>
          <span className="muted small">{placed.length} of {data.roster.length} on the grid</span>
          <div className="spacer" />
          <button type="button" onClick={onClose}>Done</button>
        </header>
        <div className="tg-team-bar">
          <input ref={search} type="search" placeholder="Search name or role" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search name or role" />
          <div className="seg" role="group" aria-label="Show">
            {tabs.map(([id, label, n]) => (
              <button key={id} type="button" className={'chip' + (show === id ? ' on' : '')} aria-pressed={show === id}
                disabled={id === 'todo' && narrowed} onClick={() => setShow(id)}>{label} <span className="muted">{n}</span></button>
            ))}
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by">
            <option value="name">Sort: Name</option>
            <option value="box">Sort: Box</option>
            <option value="perf">Sort: Performance</option>
          </select>
        </div>
        {narrowed && (
          <div className="tg-boxfilter">
            {box && <>In <b>{box} {data.copy[layout][box].title}</b> <button type="button" className="link" onClick={onClearBox}>Show everyone</button></>}
            {level && <span className="muted">Job level: {levelLabel(level)} (change it on the board)</span>}
          </div>
        )}
        <div className="tg-team-groups">
          {groups.map(([teamName, rows]) => {
            const todoN = rows.filter((x) => x.kind === 'todo').length;
            return (
              <TeamGroup key={teamName} team={teamName} count={rows.length} className="tg-team"
                meta={todoN ? <span className="muted small">· {todoN} not on the grid</span> : undefined}>
                <ul className="tg-rows">
                  {rows.map((x) => x.kind === 'rated' ? (
                    <li key={x.e.id} className="tg-rowi">
                      <button type="button" className="tg-rowi-main" onClick={() => onOpen(x.e.id)} title="Open details">
                        <span className={'tg-box-tag z-' + zoneOf(layout, x.e.p.box)}>{x.e.p.box}</span>
                        <span className="tg-rowi-name"><b>{x.e.name}</b><span className="muted small">{[x.e.role, levelLabel(x.e.level), data.copy[layout][x.e.p.box].title].filter(Boolean).join(' · ')}</span></span>
                        <span className="tg-rowi-avg small"><span>Perf <b>{fmtAvg(x.e.p.perf)}</b></span><span>Pot <b>{fmtAvg(x.e.p.pot)}</b></span></span>
                      </button>
                      <button type="button" className="tg-rowi-move tg-reveal small" onClick={() => onMove(x.e.id)} aria-label={`Move ${x.e.name} to box`}>Move…</button>
                    </li>
                  ) : (
                    <li key={x.r.bambooId} className="tg-rowi tg-rowi-todo">
                      <span className="tg-rowi-main tg-static">
                        <span className="tg-box-tag tg-tag-none" aria-hidden="true">—</span>
                        <span className="tg-rowi-name"><b>{x.r.name}</b><span className="muted small">Not on the grid yet</span></span>
                      </span>
                      <button type="button" className="primary small tg-add" onClick={() => onRate(x.r)} aria-label={`Add ${x.r.name} to the grid`}>+ Add to grid</button>
                    </li>
                  ))}
                </ul>
              </TeamGroup>
            );
          })}
          {!groups.length && (
            <p className="muted tg-none">{needle || narrowed ? 'No one matches.'
              : show === 'todo' ? 'Everyone in your team is on the grid.' : 'No one in the selected team. Sync now, or pick a team in the header.'}</p>
          )}
        </div>
        {outside.length > 0 && !box && (
          <details className="tg-outside small">
            <summary>{outside.length} rated {outside.length === 1 ? 'person is' : 'people are'} not in the selected team</summary>
            <p className="muted">Kept until you delete them: they may have moved team, or a different team is selected. They are left out of the grid and the CSV.</p>
            <ul className="tg-rows">
              {outside.map((e) => (
                <li key={e.id} className="tg-rowi">
                  <span className="tg-rowi-main tg-static"><span className="tg-rowi-name"><b>{e.name}</b><span className="muted small">{levelLabel(e.level)}</span></span></span>
                  <button type="button" className="tg-rowi-move small danger" onClick={() => onDelete(e)} aria-label={`Delete ${e.name}`}>Delete…</button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

/** one box in full (the grid's "More"): who is in it, what it takes, and every recommended action */
function BoxModal({ box, layout, data, total, people, level, onClose, onOpen, onMove }: {
  box: string; layout: Layout; data: TalentState; total: number; people: Placed[]; level: Level | '';
  onClose: () => void; onOpen: (id: string) => void; onMove: (id: string) => void;
}) {
  const c = data.copy[layout][box];
  const z = zoneInfo(zoneOf(layout, box));
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus(); }, []);
  return (
    <ModalSheet label={`${box} ${c.title}`} onClose={onClose} wide>
      <header className="sheet-head">
        <span className={'tg-box-tag z-' + z.id}>{box}</span>
        <h2>{c.title}</h2>
        <span className="muted small">{people.length} {people.length === 1 ? 'person' : 'people'} · {pct(people.length, total)}%{level ? ` · ${levelLabel(level)}` : ''}</span>
        <div className="spacer" />
        <button ref={close} type="button" onClick={onClose}>Close</button>
      </header>
      <div className={'tg-preview z-' + z.id}>
        <div>
          <b>{z.label}</b> <span className="muted small">· {z.meaning}</span>
          <div className="small">{c.description}</div>
          <div className="small muted">Needs {boxRangeText(layout, box)} ({layout}×{layout})</div>
        </div>
      </div>
      <div className="tg-boxmodal">
        <section>
          <h4>People</h4>
          {people.length ? (
            <ul className="tg-rows">
              {people.map((e) => (
                <li key={e.id} className="tg-rowi">
                  <button type="button" className="tg-rowi-main" onClick={() => onOpen(e.id)} title="Open details">
                    <span className="tg-rowi-name"><b>{e.name}</b><span className="muted small">{[e.role, levelLabel(e.level), e.team].filter(Boolean).join(' · ')}</span></span>
                    <span className="tg-rowi-avg small"><span>Perf <b>{fmtAvg(e.p.perf)}</b></span><span>Pot <b>{fmtAvg(e.p.pot)}</b></span></span>
                  </button>
                  <button type="button" className="tg-rowi-move tg-reveal small" onClick={() => onMove(e.id)} aria-label={`Move ${e.name} to box`}>Move…</button>
                </li>
              ))}
            </ul>
          ) : <p className="muted small">No one in this box{level ? ' at this job level' : ''}.</p>}
        </section>
        <section>
          <h4>Recommended actions</h4>
          <ol className="small tg-actions">{c.actions.map((a) => <li key={a}>{a}</li>)}</ol>
        </section>
      </div>
    </ModalSheet>
  );
}
