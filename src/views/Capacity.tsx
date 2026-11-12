// Available person-days per squad per sprint; Planned and Draft leave shown
// separately. Net (worst case) assumes every Draft gets approved.
import { Fragment, useState } from 'react';
import { fmtRange, pct } from '../format.ts';
import type { CapacityPeriod } from '../types.ts';

const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

export function CapacityView({ periods }: { periods: CapacityPeriod[] | null }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!periods) return <div className="empty">Loading…</div>;
  if (!periods.length || periods.every((p) => !p.teams.length)) return <div className="empty">Nobody in scope matches these filters.</div>;
  return (
    <div className="cap-wrap">
      {periods.map((p) => (
        <section key={p.id} className="cap-period">
          <h3>{p.name} <span className="muted small">{fmtRange(p.from, p.to)}</span></h3>
          <table className="list cap">
            <thead>
              <tr>
                <th>Squad</th><th className="num">People</th><th className="num">Available</th>
                <th className="num">Planned out</th><th className="num">Draft out</th>
                <th className="num">Net (planned)</th><th className="num">Net (if drafts approved)</th>
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
                      <td><span className="caret">{open[key] ? '▾' : '▸'}</span> {t.team}</td>
                      <td className="num">{t.headcount}</td>
                      <td className="num">{n(t.available)}</td>
                      <td className="num planned-text">{n(t.plannedOut)}</td>
                      <td className="num draft-text">{n(t.draftOut)}</td>
                      <td className="num">{n(t.netPlanned)}</td>
                      <td className="num strong">{n(t.net)}</td>
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
                <td className="num">{n(p.teams.reduce((a, t) => a + t.netPlanned, 0))}</td>
                <td className="num strong">{n(p.teams.reduce((a, t) => a + t.net, 0))}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </section>
      ))}
      <p className="muted small">Available = working days in the sprint − public holidays for each person’s location. Half days count 0.5.</p>
    </div>
  );
}
