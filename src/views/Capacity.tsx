// Available person-days per squad per sprint; Planned and Draft leave shown
// separately. Net (worst case) assumes every Draft gets approved. Work from
// home is NOT leave: those people are working, so WFH days stay available
// (shown in their own column for information only).
import { CopyButton } from '../components/CopyButton.tsx';
import { Sortable } from '../components/Sortable.tsx';
import { autoLayout, resetLayouts } from '../state/layout.ts';
import { Fragment, useEffect, useState } from 'react';
import { api, type CapTotals, type QuarterCapacity } from '../api.ts';
import { openInBamboo } from '../bamboo-link.ts';
import { fmtDay, fmtRange, fmtShort, pct, sprintName } from '../format.ts';
import type { CapacityPeriod, UiFilters } from '../types.ts';
import { TeamTag } from '../components/TeamColor.tsx';
import { ListModeSwitch, TeamFlow } from '../components/PeopleFlow.tsx';
import { useListMode } from '../state/listMode.ts';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const qOf = (d: string) => Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1;

/** working days available after leave for one calendar quarter — the headline */
function QuarterPanel({ filters, version }: { filters: UiFilters; version: number }) {
  // starts on the filter range's quarter; the parent remounts this (key) when
  // the range moves to another quarter
  const [sel, setSel] = useState(() => ({ year: Number(filters.from.slice(0, 4)), q: qOf(filters.from) }));
  const [data, setData] = useState<QuarterCapacity | null>(null);
  const key = JSON.stringify([filters.teams, filters.people, filters.locations, filters.types]);
  useEffect(() => {
    let live = true;
    void api.getQuarterCapacity(filters, sel.year, sel.q).then((d) => { if (live) setData(d); });
    return () => { live = false; };
  }, [sel.year, sel.q, key, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = (dir: number) => setSel((s) => {
    const i = s.year * 4 + (s.q - 1) + dir;
    return { year: Math.floor(i / 4), q: (i % 4) + 1 };
  });
  if (!data) return <div className="q-cap"><div className="muted">Loading quarter…</div></div>;
  const t = data.total;
  const isNow = data.today >= data.from && data.today <= data.to;
  return (
    <section className="q-cap" aria-label="Quarter capacity" data-copy>
      <div className="q-cap-head">
        <button type="button" className="q-nav" onClick={() => step(-1)} aria-label="Previous quarter">‹</button>
        <h2>Q{data.q} {data.year}</h2>
        <button type="button" className="q-nav" onClick={() => step(1)} aria-label="Next quarter">›</button>
        <span className="muted small">{fmtRange(data.from, data.to)}</span>
        {isNow && <span className="role-badge current">This quarter</span>}
        <CopyButton />
      </div>
      <div className="q-cap-body">
        <div className="q-hero">
          <span className="cap-l">Working days available after leave</span>
          <span className="q-hero-v">{n(t.available)}<small> days</small></span>
          <span className="small">of <b>{n(t.working)}</b> working days · <b>{t.working ? pct(t.available / t.working) : '—'}</b> capacity</span>
          <span className="muted small">{n(t.ifDrafts)} if all drafts are approved · {t.headcount} people</span>
          <CapBar t={t} />
          <div className="q-legend small">
            <span><i className="sw-cap avail" />Free even if drafts approved {n(t.ifDrafts)}</span>
            <span><i className="sw-cap draft" />Draft leave {n(t.draftOut)}</span>
            <span><i className="sw-cap planned" />Approved leave {n(t.plannedOut)}</span>
            <span className="wfh-text">WFH {n(t.wfh)} (counted as available)</span>
          </div>
        </div>
        <div className="q-months">
          {data.months.map((m) => {
            const cur = data.today.slice(0, 7) === m.month;
            return (
              <div key={m.month} className={'q-month' + (cur ? ' cur' : '')}>
                <span className={'q-month-n' + (cur ? ' month-cur' : '')}>{MONTHS[Number(m.month.slice(5, 7)) - 1]}</span>
                <span className="q-month-v">{n(m.available)}<small> / {n(m.working)}</small></span>
                <CapBar t={m} thin />
              </div>
            );
          })}
        </div>
        {data.teams.length > 1 && (
          <div className="q-teams">
            {data.teams.map((x) => (
              <div key={x.team} className="q-team" title={`${x.team}: ${n(x.available)} of ${n(x.working)} working days available (${x.headcount} people)`}>
                <span className="q-team-n"><TeamTag name={x.team} plain /></span>
                <span className="q-team-v">{n(x.available)}<small> / {n(x.working)}</small></span>
                <CapBar t={x} thin />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** working days split: available | approved leave | draft leave */
function CapBar({ t, thin }: { t: CapTotals; thin?: boolean }) {
  if (!t.working) return null;
  const w = (v: number) => `${Math.max(0, (v / t.working) * 100)}%`;
  return (
    <div className={'cap-split' + (thin ? ' thin' : '')} role="img"
      aria-label={`${n(t.available)} available, ${n(t.plannedOut)} approved leave, ${n(t.draftOut)} draft leave`}>
      <span className="avail" style={{ width: w(t.available - t.draftOut) }} />
      <span className="draft" style={{ width: w(t.draftOut) }} />
      <span className="planned" style={{ width: w(t.plannedOut) }} />
    </div>
  );
}

const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

export function CapacityView({ periods, filters, version }: { periods: CapacityPeriod[] | null; filters: UiFilters; version: number }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!periods) return <div className="empty">Loading…</div>;
  if (!periods.length || periods.every((p) => !p.teams.length)) return <div className="empty">Nobody in scope matches these filters.</div>;
  return (
    <div className="cap-wrap cap-board">
      <div className="dash-bar cap-bar">
        <button type="button" className="auto-layout" onClick={autoLayout} title="Arrange the widgets to fill this window">Auto layout</button>
        <button type="button" className="link small" onClick={resetLayouts} title="Put every widget back in its default place and size">Reset layout</button>
      </div>
      <Sortable grid units maxCols={4} minCol={280} id="capacity" className="cap-sort" items={[
        { key: 'quarter', span: 4, node: <QuarterPanel key={`${filters.from.slice(0, 4)}-${qOf(filters.from)}`} filters={filters} version={version} /> },
        ...periods.map((p) => {
        const sum = (k: 'available' | 'plannedOut' | 'draftOut' | 'wfh' | 'netPlanned' | 'net') => p.teams.reduce((a, t) => a + t[k], 0);
        const work = sum('available'), after = sum('netPlanned'), worst = sum('net');
        return { key: 'period:' + p.id, span: 4, node: (
        <section className="cap-period widget" data-copy>
          <h3 title={p.name}>{sprintName(p.name)} <span className="muted small">{fmtRange(p.from, p.to)}</span><CopyButton /></h3>
          <div className="cap-sum">
            <div className="cap-tile main">
              <span className="cap-l">Available after leave</span>
              <span className="cap-v">{n(after)}<small> days</small></span>
              <span className="muted small">{work ? pct(after / work) : '—'} of working days · {n(worst)} if all drafts are approved</span>
            </div>
            <div className="cap-tile"><span className="cap-l">Working days</span><span className="cap-v">{n(work)}</span><span className="muted small">{p.teams.reduce((a, t) => a + t.headcount, 0)} people, minus holidays</span></div>
            <div className="cap-tile"><span className="cap-l">Leave</span><span className="cap-v">{n(sum('plannedOut') + sum('draftOut'))}</span>
              <span className="small"><span className="planned-text">{n(sum('plannedOut'))} approved</span> · <span className="draft-text">{n(sum('draftOut'))} draft</span></span></div>
            <div className="cap-tile"><span className="cap-l">Work from home</span><span className="cap-v wfh-text">{n(sum('wfh'))}</span><span className="muted small">counted as available</span></div>
          </div>
          <table className="list cap">
            <thead>
              <tr>
                <th>Squad</th><th className="num">People</th><th className="num">Working days</th>
                <th className="num">Leave approved</th><th className="num">Leave draft</th>
                <th className="num" title="Work-from-home days — counted as available">WFH</th>
                <th className="num">Available after leave</th><th className="num">If drafts approved</th>
                <th>Capacity</th><th className="num">Overlap days</th>
              </tr>
            </thead>
            <tbody>
              {p.teams.map((t) => {
                const key = p.id + '|' + t.team;
                const capP = t.available ? t.netPlanned / t.available : 1;
                const capW = t.available ? t.net / t.available : 1;
                return (
                  <Fragment key={key}>
                    <tr className="cap-team" onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}>
                      <td><span className="caret">{open[key] ? '▾' : '▸'}</span> <TeamTag name={t.team} /></td>
                      <td className="num">{t.headcount}</td>
                      <td className="num">{n(t.available)}</td>
                      <td className="num planned-text">{n(t.plannedOut)}</td>
                      <td className="num draft-text">{n(t.draftOut)}</td>
                      <td className="num wfh-text">{t.wfh ? n(t.wfh) : ''}</td>
                      <td className="num strong">{n(t.netPlanned)}</td>
                      <td className="num">{n(t.net)}</td>
                      <td>
                        <div className="bar" title={`Planned leave leaves ${pct(capP)}; with drafts ${pct(capW)}`}>
                          <div className="bar-w" style={{ width: pct(Math.max(0, capW)) }} />
                          <div className="bar-d" style={{ left: pct(Math.max(0, capW)), width: pct(Math.max(0, capP - capW)) }} />
                        </div>
                        <span className="small muted">{pct(capW)}–{pct(capP)}</span>
                      </td>
                      <td className={'num' + (t.overlapDays ? ' warn-text strong' : '')} title={`threshold ${pct(t.threshold)} of squad`}>
                        {t.overlapDays}
                      </td>
                    </tr>
                    {open[key] && t.people.map((pp) => (
                      <tr key={key + pp.id} className="cap-person">
                        <td className="indent">{pp.displayName}</td>
                        <td />
                        <td className="num">{n(pp.available)}</td>
                        <td className="num planned-text">{pp.plannedOut ? n(pp.plannedOut) : ''}</td>
                        <td className="num draft-text">{pp.draftOut ? n(pp.draftOut) : ''}</td>
                        <td className="num wfh-text">{pp.wfh ? n(pp.wfh) : ''}</td>
                        <td className="num">{n(pp.available - pp.plannedOut)}</td>
                        <td className="num">{n(pp.net)}</td>
                        <td colSpan={2} />
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{p.teams.reduce((a, t) => a + t.headcount, 0)}</td>
                <td className="num">{n(p.teams.reduce((a, t) => a + t.available, 0))}</td>
                <td className="num planned-text">{n(p.teams.reduce((a, t) => a + t.plannedOut, 0))}</td>
                <td className="num draft-text">{n(p.teams.reduce((a, t) => a + t.draftOut, 0))}</td>
                <td className="num wfh-text">{n(sum('wfh'))}</td>
                <td className="num strong">{n(after)}</td>
                <td className="num">{n(worst)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
          <OnLeaveList people={p.onLeave} />
        </section>
        ) };
      })]} />
      <p className="muted small">Working days = weekdays in the sprint − public holidays for each person’s location. Available after leave = working days − approved leave; “if drafts approved” also takes off draft leave. Work from home is not leave — those days stay available. Half days count 0.5.</p>
    </div>
  );
}

/** who is on leave in the sprint (WFH excluded), most days first */
function OnLeaveList({ people }: { people: CapacityPeriod['onLeave'] }) {
  const [mode, setMode] = useListMode('cap-onleave');
  const total = people.reduce((a, p) => a + p.planned + p.draft, 0);
  return (
    <div className="cap-leave">
      <div className="cap-leave-h">
        <b>People on leave</b>
        <span className="muted small">{people.length} {people.length === 1 ? 'person' : 'people'} · {n(total)} days</span>
        {people.length > 0 && <ListModeSwitch mode={mode} onChange={setMode} />}
      </div>
      {people.length ? (
        <TeamFlow counts rows={mode === 'rows'} people={people.map((p) => ({
          key: p.employeeId, name: p.person, team: p.team, status: p.draft && !p.planned ? 'draft' : p.draft ? 'mixed' : 'planned',
          suffix: `${n(p.planned + p.draft)}d`,
          title: `${p.person} · ${p.team}\n${p.types.join(', ')}\n${fmtDay(p.first)} – ${fmtDay(p.last)}`,
          detail: <>
            <span>{p.types.join(', ')}</span>
            <span className="sd-when">{p.first === p.last ? fmtShort(p.first) : `${fmtShort(p.first)}–${fmtShort(p.last)}`}</span>
            {p.draft > 0 && <span className="draft-text">{n(p.draft)} draft</span>}
          </>,
          actions: p.url ? <button type="button" className="link small" title="Open in BambooHR" onClick={() => openInBamboo(p.url)}>↗</button> : undefined,
        }))} meta={(team) => <span className="muted small">· {n(people.filter((p) => p.team === team).reduce((a, p) => a + p.planned + p.draft, 0))} d</span>} />
      ) : <div className="muted small">Nobody on leave this sprint.</div>}
    </div>
  );
}
