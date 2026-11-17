// People board: one person's capacity split across every epic they hold
// tickets in, over all projects, sprint by sprint. Working days, available
// days after their own leave, and the days Jira puts on them. Leave is shown
// as days and dates only — never the type.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { api, type AllocCell, type AllocItem, type AllocationData, type BandName } from '../api.ts';
import { fmtRange, fmtShort, leaveRanges, sprintName } from '../format.ts';
import { Select } from '../components/Select.tsx';
import { CopyButton } from '../components/CopyButton.tsx';
import { copyList, type Item } from '../copy.ts';

const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const pct = (x: number | null) => (x === null ? 'no capacity' : `${Math.round(x * 100)}%`);
const ICON = { green: '●', amber: '▲', red: '■' } as const;
const WORD = { green: 'Fits', amber: 'Full', red: 'Over capacity' } as const;
const bandOf = (load: number | null): BandName => (load === null || load > 1 ? 'red' : load > 0.8 ? 'amber' : 'green');
const SLOTS = 5; // epic colours; a person's 6th+ epic folds into "Other"
const ALL = '__all';

/** a cell narrowed to the epics in view (one project, or all) */
function narrow(c: AllocCell, keep: Set<string> | null): AllocCell {
  if (!keep) return c;
  const items = c.items.filter((i) => keep.has(i.epicKey));
  const s = (k: 'jira' | 'done' | 'remaining' | 'tickets' | 'open') => Math.round(items.reduce((a, i) => a + i[k], 0) * 100) / 100;
  const jira = s('jira'), remaining = s('remaining');
  const load = jira <= 0 ? 0 : c.available > 0 ? jira / c.available : null;
  const loadAhead = c.availableAhead === null ? null : remaining <= 0 ? 0 : c.availableAhead > 0 ? remaining / c.availableAhead : null;
  return { ...c, items, jira, remaining, done: s('done'), tickets: s('tickets'), open: s('open'), load, band: bandOf(load), loadAhead };
}

function Load({ load }: { load: number | null }) {
  const b = bandOf(load);
  return <span className={'band ' + b} title={WORD[b]}><span aria-hidden="true">{ICON[b]}</span> {pct(load)}</span>;
}

/** available days as the track, each epic's Jira days stacked on it; the
 *  tick is their capacity, anything past it is over */
function StackBar({ c, colour, label }: { c: AllocCell; colour: (k: string) => number; label: (k: string) => string }) {
  const scale = Math.max(c.available, c.jira, 0.01);
  return (
    <div className="alloc-bar" role="img" aria-label={`${n(c.jira)} days in Jira against ${n(c.available)} available`}>
      <div className="alloc-cap" style={{ width: `${(c.available / scale) * 100}%` }} />
      <div className="alloc-segs">
        {c.items.map((i) => (
          <div key={i.epicKey} className={'alloc-seg ep-' + colour(i.epicKey)} style={{ width: `${(i.jira / scale) * 100}%` }}
            title={`${label(i.epicKey)}\n${n(i.jira)} d in Jira · ${n(i.remaining)} d remaining · ${i.open}/${i.tickets} open`} />
        ))}
      </div>
      {c.jira > c.available && <div className="alloc-tick" style={{ left: `${(c.available / scale) * 100}%` }} title={`capacity: ${n(c.available)} d`} />}
    </div>
  );
}

function Cell({ c, active, colour, label }: { c: AllocCell; active: boolean; colour: (k: string) => number; label: (k: string) => string }) {
  const leave = leaveRanges(c.leaveDates);
  return (
    <>
      <div className="cell-avail" title={`${c.working} working days − ${n(c.leave)} days of their leave = ${n(c.available)} available`}>
        <b>{n(c.available)}</b><span className="muted"> of {c.working} d</span>
        {c.leave > 0 && <span className="leave-pill" title={leave.join('\n')}>−{n(c.leave)} leave</span>}
      </div>
      {c.leave > 0 && <div className="leave-dates">{leave.slice(0, 2).join(' · ')}{leave.length > 2 && <span className="muted"> · +{leave.length - 2}</span>}</div>}
      {c.tickets > 0 ? <>
        <StackBar c={c} colour={colour} label={label} />
        {c.jira > 0
          ? <div className="small"><Load load={c.load} /> <span className="muted">{n(c.jira)} d in Jira</span></div>
          : <div className="warn-text small">{c.tickets} {c.tickets === 1 ? 'ticket' : 'tickets'}, no estimate</div>}
        {active && <div className="muted small" title="Remaining estimate vs their available days from today">
          left {n(c.remaining)} of {n(c.availableAhead ?? 0)} d{c.loadAhead !== null && c.remaining > 0 ? ` · ${pct(c.loadAhead)}` : ''}</div>}
      </> : <div className="muted small">no tickets · {n(c.available)} d free</div>}
    </>
  );
}

export function PeopleView({ version }: { version: number }) {
  const [data, setData] = useState<AllocationData | null>(null);
  const [err, setErr] = useState('');
  const [from, setFrom] = useState<string | null>(null); // null = the active sprint
  const [project, setProject] = useState(ALL);
  const [open, setOpen] = useState<Record<string, boolean>>({}); // person → epic rows shown (folded by default)
  const [overOnly, setOverOnly] = useState(false);

  useEffect(() => {
    let live = true;
    api.getAllocation().then((d) => { if (live) { setData(d); setErr(''); } }).catch((e) => live && setErr(String(e?.message ?? e)));
    return () => { live = false; };
  }, [version]);

  const epicOf = useMemo(() => new Map((data?.epics ?? []).map((e) => [e.key, e])), [data]);
  const keep = useMemo(() => (project === ALL || !data ? null
    : new Set(data.epics.filter((e) => e.projects.some((p) => p.id === project)).map((e) => e.key))), [data, project]);

  if (!data) return <div className="empty">{err || 'Loading…'}</div>;
  if (!data.projects.length) {
    return <div className="empty">No project has Jira data yet. Add a project under Projects (and refresh it from Jira) — this board then shows each person’s capacity across all of them.</div>;
  }

  const all = data.sprints;
  const activeIdx = all.findIndex((s) => s.state === 'active');
  const defIdx = activeIdx >= 0 ? activeIdx : Math.max(0, all.findIndex((s) => s.state === 'future'));
  const fromIdx = from === null ? defIdx : Math.max(0, all.findIndex((s) => s.name === from));
  const shown = all.map((s, i) => ({ ...s, i })).slice(fromIdx);

  const label = (k: string) => { const e = epicOf.get(k); return e ? `${k} · ${e.summary}` : k; };
  const jiraUrl = (k: string) => (data.jiraSite ? `https://${data.jiraSite}/browse/${encodeURIComponent(k)}` : '');
  const openUrl = (u: string) => { if (u) void tiny.app.shell.open(u).catch(() => {}); };

  const rows = data.people
    .map((p) => ({ p, cells: p.cells.map((c) => narrow(c, keep)), backlog: keep ? p.backlog.items.filter((i) => keep.has(i.epicKey)) : p.backlog.items }))
    .filter((r) => !keep || r.p.epics.some((k) => keep.has(k)))
    .filter((r) => !overOnly || shown.some((s) => r.cells[s.i].tickets > 0 && bandOf(r.cells[s.i].load) === 'red'));
  const overNow = activeIdx < 0 ? 0 : rows.filter((r) => r.cells[activeIdx].tickets > 0 && bandOf(r.cells[activeIdx].load) === 'red').length;
  const multi = rows.filter((r) => r.p.epics.filter((k) => !keep || keep.has(k)).length > 1).length;
  const allOpen = rows.length > 0 && rows.every((r) => open[r.p.id]);
  const hasBacklog = rows.some((r) => r.backlog.length > 0);
  // what Copy puts on the clipboard: person → sprint → epic, as nested bullets
  const tix = (k: number, open = false) => `${k} ${open ? 'open ' : ''}${k === 1 ? 'ticket' : 'tickets'}`;
  const loadText = (c: AllocCell) => (!c.tickets ? 'no tickets' : c.jira <= 0 ? `${c.tickets} unestimated ${c.tickets === 1 ? 'ticket' : 'tickets'}` : `${n(c.jira)} d in Jira · load ${pct(c.load)}`);
  const bullets: Item[] = rows.map(({ p, cells, backlog }) => {
    const mine = p.epics.filter((k) => !keep || keep.has(k));
    const sprintsOut: Item[] = shown.map((s) => {
      const c = cells[s.i];
      const leave = c.leave > 0 ? ` · leave ${n(c.leave)} d (${leaveRanges(c.leaveDates).join(', ')})` : '';
      const left = s.state === 'active' && c.tickets ? ` · left ${n(c.remaining)} of ${n(c.availableAhead ?? 0)} d from today` : '';
      return {
        text: `${sprintName(s.name)}${s.state === 'active' ? ' (active)' : ''}, ${fmtRange(s.startDate, s.endDate)}: available ${n(c.available)} of ${c.working} working days${leave} · ${loadText(c)}${left}`,
        kids: c.items.map((it) => {
          const e = epicOf.get(it.epicKey);
          return { text: `${it.epicKey} ${e?.summary ?? ''}${e ? ` (${e.projects.map((x) => x.name).join(', ')})` : ''}: ${n(it.jira)} d · ${c.available > 0 ? `${Math.round((it.jira / c.available) * 100)}% of their days` : 'no days free'} · ${n(it.remaining)} d left · ${it.open}/${it.tickets} open` };
        }),
      };
    });
    const t = shown.reduce((a, s) => { const c = cells[s.i]; return { w: a.w + c.working, l: a.l + c.leave, av: a.av + c.available, j: a.j + c.jira }; }, { w: 0, l: 0, av: 0, j: 0 });
    const extra: Item[] = [{ text: `Total over ${shown.length} ${shown.length === 1 ? 'sprint' : 'sprints'}: available ${n(t.av)} of ${t.w} working days${t.l ? ` · leave ${n(t.l)} d` : ''} · ${n(t.j)} d in Jira · load ${pct(t.j <= 0 ? 0 : t.av > 0 ? t.j / t.av : null)} · ${n(Math.max(0, t.av - t.j))} d unallocated` }];
    if (backlog.length) extra.push({ text: `Not in a sprint: ${n(backlog.reduce((a, x) => a + x.remaining, 0))} d in ${tix(backlog.reduce((a, x) => a + x.open, 0), true)}` });
    return { text: `${p.name} — ${mine.length} ${mine.length === 1 ? 'epic' : 'epics'}${p.leaveKnown ? '' : ' · leave unknown'}`, kids: [...sprintsOut, ...extra] };
  });
  if (!keep) {
    const un = shown.filter((s) => data.unassigned[s.i].tickets > 0).map((s) => ({ text: `${sprintName(s.name)}: ${n(data.unassigned[s.i].jira)} d in ${tix(data.unassigned[s.i].tickets)}` }));
    if (data.unassignedBacklog.tickets) un.push({ text: `Not in a sprint: ${n(data.unassignedBacklog.remaining)} d in ${tix(data.unassignedBacklog.tickets, true)}` });
    if (un.length) bullets.push({ text: 'Unassigned', kids: un });
  }

  return (
    <div className="cap-wrap people-board" data-copy data-copy-list={copyList(bullets)}>
      <div className="row wrap">
        <span className="small"><b>{rows.length}</b> {rows.length === 1 ? 'person' : 'people'} across {keep ? 1 : data.projects.length} {keep || data.projects.length === 1 ? 'project' : 'projects'}
          {multi > 0 && <span className="muted"> · {multi} on more than one epic</span>}
          {overNow > 0 && <span className="warn-text"> · {overNow} over capacity this sprint</span>}</span>
        <div className="spacer" />
        <span className="small" data-nocopy>Project</span>
        <Select value={project} minWidth={180} onChange={setProject}
          options={[{ value: ALL, label: 'All projects' }, ...data.projects.map((p) => ({ value: p.id, label: p.name }))]} />
        <span className="small" data-nocopy>From</span>
        <Select value={all[fromIdx]?.name ?? ''} minWidth={170} onChange={setFrom}
          options={all.map((s) => ({ value: s.name, label: `${sprintName(s.name)} · ${fmtShort(s.startDate)}` }))} />
        {fromIdx !== 0 && <button type="button" className="link small" onClick={() => setFrom(all[0].name)}>Back to {sprintName(all[0].name)}</button>}
        <label className="small inline-check" data-nocopy><input type="checkbox" checked={overOnly} onChange={(e) => setOverOnly(e.target.checked)} /> Only over capacity</label>
        <button type="button" className="link small" onClick={() => setOpen(Object.fromEntries(rows.map((r) => [r.p.id, !allOpen])))}>{allOpen ? 'Collapse all' : 'Show all epics'}</button>
        <CopyButton title="Copy as a bullet list: each person → sprint (working, available, leave, days in Jira, load) → epic" />
      </div>
      {data.missing.length > 0 && <div className="banner">Not counted yet — no Jira data: {data.missing.join(', ')}. Refresh them under Projects.</div>}

      <p className="muted small alloc-legend" data-nocopy>
        Each cell: <b>available</b> of working days (after their own leave and holidays) · the bar is their available days, each colour one of their epics’ days in Jira (colours are per person — click a person for the epic split) ·
        load = days in Jira ÷ available: <span className="band green">{ICON.green} ≤ 80%</span> <span className="band amber">{ICON.amber} ≤ 100%</span> <span className="band red">{ICON.red} over</span>
      </p>

      {!rows.length ? <div className="empty">{overOnly ? 'Nobody is over capacity in these sprints.' : 'No one has tickets in this project.'}</div> : (
      <div className="grid-scroll">
        <table className="list cap sprint-grid alloc-grid">
          <thead>
            <tr>
              <th>Person</th>
              {shown.map((s) => (
                <th key={s.name} className={s.state === 'active' ? 'sprint-active' : ''} title={s.name}>
                  {sprintName(s.name)} {s.state === 'active' && <span className="tag">active</span>}
                  <div className="muted small">{fmtRange(s.startDate, s.endDate)}</div>
                </th>
              ))}
              <th className="alloc-total" title="Across the sprints shown">Total{shown.length > 1 ? ` · ${shown.length} sprints` : ''}</th>
              {hasBacklog && <th title="Open tickets not in any calendar sprint">Not in a sprint</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, cells, backlog }) => {
              const mine = p.epics.filter((k) => !keep || keep.has(k));
              const colour = (k: string) => { const i = p.epics.indexOf(k); return i >= 0 && i < SLOTS ? i + 1 : 0; }; // follows the epic, not the filter
              const isOpen = !!open[p.id];
              const projects = new Set(mine.flatMap((k) => epicOf.get(k)?.projects.map((x) => x.id) ?? []));
              return (
                <Fragment key={p.id}>
                  <tr className="alloc-person" onClick={() => setOpen({ ...open, [p.id]: !isOpen })} aria-expanded={isOpen}>
                    <td>
                      {isOpen ? '▾' : '▸'} <b>{p.name}</b>
                      <div className="muted small">{mine.length} {mine.length === 1 ? 'epic' : 'epics'}{projects.size > 1 ? ` · ${projects.size} projects` : ''}</div>
                      {!p.leaveKnown && <div className="warn-text small" title="Not matched to a BambooHR person: weekdays counted, leave unknown">leave unknown</div>}
                    </td>
                    {shown.map((s) => (
                      <td key={s.name} className={(s.state === 'active' ? 'sprint-active ' : '') + (cells[s.i].tickets ? '' : 'not-in-sprint')}>
                        <Cell c={cells[s.i]} active={s.state === 'active'} colour={colour} label={label} />
                      </td>
                    ))}
                    <td className="alloc-total">{(() => {
                      const t = shown.reduce((a, s) => { const c = cells[s.i]; return { w: a.w + c.working, l: a.l + c.leave, av: a.av + c.available, j: a.j + c.jira }; }, { w: 0, l: 0, av: 0, j: 0 });
                      const load = t.j <= 0 ? 0 : t.av > 0 ? t.j / t.av : null;
                      return <>
                        <div title={`${t.w} working − ${n(t.l)} leave`}><b>{n(t.av)}</b><span className="muted"> of {t.w} d</span>{t.l > 0 && <span className="leave-pill">−{n(t.l)} leave</span>}</div>
                        <div className="small">{t.j > 0 ? <><Load load={load} /> <span className="muted">{n(t.j)} d in Jira</span></> : <span className="muted">no estimated work</span>}</div>
                        <div className="muted small">{n(Math.max(0, t.av - t.j))} d unallocated</div>
                      </>;
                    })()}</td>
                    {hasBacklog && <td>{backlog.length ? <><b>{n(backlog.reduce((a, i) => a + i.remaining, 0))} d</b>
                      <div className="muted small">{(() => { const k = backlog.reduce((a, i) => a + i.open, 0); return `${k} open ${k === 1 ? 'ticket' : 'tickets'}`; })()}</div></> : <span className="muted small">—</span>}</td>}
                  </tr>
                  {isOpen && mine.map((k) => {
                    const e = epicOf.get(k);
                    const at = (c: AllocCell): AllocItem | undefined => c.items.find((i) => i.epicKey === k);
                    const bl = backlog.find((i) => i.epicKey === k);
                    return (
                      <tr key={k} className="alloc-epic">
                        <td>
                          <span className={'alloc-swatch ep-' + colour(k)} aria-hidden="true" />
                          <button type="button" className="link small mono" onClick={(ev) => { ev.stopPropagation(); openUrl(jiraUrl(k)); }} disabled={!data.jiraSite}>{k}</button>
                          {colour(k) === 0 && <span className="muted small"> (other)</span>}
                          <div className="small alloc-epic-name" title={e?.summary}>{e?.summary ?? ''}</div>
                          {e && <div className="muted small">{e.projects.map((x) => x.name).join(' · ')}{e.done ? ' · epic done' : ''}</div>}
                        </td>
                        {shown.map((s) => {
                          const it = at(cells[s.i]);
                          const c = cells[s.i];
                          return (
                            <td key={s.name} className={s.state === 'active' ? 'sprint-active' : ''}>
                              {it ? <>
                                <b>{n(it.jira)} d</b><span className="muted small"> · {c.available > 0 ? `${Math.round((it.jira / c.available) * 100)}% of their days` : 'no days free'}</span>
                                <div className="muted small">{n(it.remaining)} d left · {it.open}/{it.tickets} open</div>
                              </> : <span className="muted small">—</span>}
                            </td>
                          );
                        })}
                        <td className="alloc-total">{(() => {
                          const j = shown.reduce((a, s) => a + (at(cells[s.i])?.jira ?? 0), 0);
                          const av = shown.reduce((a, s) => a + cells[s.i].available, 0);
                          return j > 0 ? <><b>{n(j)} d</b><span className="muted small"> · {av > 0 ? `${Math.round((j / av) * 100)}% of their days` : 'no days free'}</span></> : <span className="muted small">—</span>;
                        })()}</td>
                        {hasBacklog && <td>{bl ? <><b>{n(bl.remaining)} d</b><div className="muted small">{bl.open} open</div></> : <span className="muted small">—</span>}</td>}
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
          {!keep && (data.unassigned.some((u) => u.tickets > 0) || data.unassignedBacklog.tickets > 0) && (
            <tfoot>
              <tr className="muted">
                <td><b>Unassigned</b><div className="small">not on anyone’s load yet</div></td>
                {shown.map((s) => {
                  const u = data.unassigned[s.i];
                  return <td key={s.name} className="small">{u.tickets ? <><b>{n(u.jira)} d</b> · {u.tickets} {u.tickets === 1 ? 'ticket' : 'tickets'}</> : '—'}</td>;
                })}
                <td className="small alloc-total">{(() => { const j = shown.reduce((a, s) => a + data.unassigned[s.i].jira, 0); return j > 0 ? <b>{n(j)} d</b> : '—'; })()}</td>
                {hasBacklog && <td className="small">{data.unassignedBacklog.tickets ? <><b>{n(data.unassignedBacklog.remaining)} d</b> · {data.unassignedBacklog.tickets} open</> : '—'}</td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      )}
      <p className="muted small">Days in Jira = estimate of their tickets in the sprint (burned + remaining, in 6-hour days); a ticket sits in the latest sprint Jira has it in. A ticket shared by two projects counts once. Leave is counted in days only.</p>
    </div>
  );
}
