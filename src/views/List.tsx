// One row per request, grouped under a header row per team (the chosen sort
// applies within each team). The export writes the same rows, with a Squad
// column instead of the headers (both use backend/domain/sort.ts).
import { fmtDays, fmtShort, sprintName, STATUS_LABEL } from '../format.ts';
import { resolvePreset, setFilters, setState, useUi } from '../state/filters.ts';
import type { LeaveRecord, SortKey, SprintInfo } from '../types.ts';
import { openInBamboo } from '../bamboo-link.ts';
import { approveLeave } from '../approve.ts';
import { TeamTag } from '../components/TeamColor.tsx';
import { useTeamGroups } from '../teamColors.ts';

const COLS: { key: SortKey; label: string; cls?: string }[] = [
  { key: 'person', label: 'Person' },
  { key: 'status', label: 'Status' },
  { key: 'typeName', label: 'Type' },
  { key: 'startDate', label: 'Dates' },
  { key: 'days', label: 'Days', cls: 'num' },
  { key: 'requestAgeDays', label: 'Request age', cls: 'num' },
];

/** the sprints a leave's dates fall in (in date order) */
const sprintsFor = (r: LeaveRecord, sprints: SprintInfo[]) =>
  sprints.filter((s) => s.startDate <= r.endDate && s.endDate >= r.startDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

export function ListView({ rows, sprints = [], today }: { rows: LeaveRecord[] | null; sprints?: SprintInfo[]; today?: string }) {
  const { sort } = useUi();
  const teams = useTeamGroups(rows ?? [], (r) => r.team);
  if (!rows) return <div className="empty">Loading…</div>;
  const setSort = (key: SortKey) =>
    setState({ sort: { key, dir: sort.key === key && sort.dir === 'asc' ? 'desc' : 'asc' } });
  return (
    <div className="list-wrap">
      <table className="list">
        <thead>
          <tr>
            {COLS.map((c) => (
              <th key={c.key} className={c.cls} onClick={() => setSort(c.key)} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        {teams.map(([team, list]) => (
        <tbody key={team}>
          <tr className="team-head-row">
            <td colSpan={COLS.length + 1}>
              <TeamTag name={team} />
              <span className="muted small">{list.length} request{list.length === 1 ? '' : 's'} · {fmtDays(list.reduce((a, r) => a + r.days, 0))}</span>
            </td>
          </tr>
          {list.map((r) => (
            <tr key={r.id}>
              <td>{r.person}<div className="muted small">{r.location}</div></td>
              <td><span className={'badge ' + r.status}>{STATUS_LABEL[r.status]}</span></td>
              <td>{r.typeName}</td>
              <td>
                <span className="nowrap">{fmtShort(r.startDate)}{r.endDate !== r.startDate ? ` – ${fmtShort(r.endDate)}` : ''}</span>
                {sprintsFor(r, sprints).map((s) => {
                  const now = !!today && s.startDate <= today && s.endDate >= today;
                  return (
                    <button type="button" key={s.name} className={'sprint-tag' + (now ? ' now' : '')}
                      title={`${s.name}: ${fmtShort(s.startDate)} – ${fmtShort(s.endDate)}${now ? ' (current)' : ''} · show only this sprint`}
                      onClick={() => today && setFilters({ preset: 'sprint:' + s.name, ...resolvePreset('sprint:' + s.name, today, sprints) })}>
                      {sprintName(s.name)}
                    </button>
                  );
                })}
              </td>
              <td className="num">{fmtDays(r.days)}</td>
              <td className={'num' + (r.status === 'draft' && (r.requestAgeDays ?? 0) > 7 ? ' warn-text' : '')}>
                {r.requestAgeDays !== null ? `${r.requestAgeDays} d` : '—'}
              </td>
              <td className="nowrap">
                {r.status === 'draft' && <button type="button" className="approve small-btn" onClick={() => approveLeave(r)} title="Approve this request in BambooHR">✓ Approve</button>}
                {r.url && <button type="button" className="link" onClick={() => openInBamboo(r.url)} title="Open in BambooHR">BambooHR ↗</button>}
              </td>
            </tr>
          ))}
        </tbody>
        ))}
      </table>
      {!rows.length && <div className="empty">No leave requests match these filters.</div>}
      <div className="list-foot muted small">{rows.length} request{rows.length === 1 ? '' : 's'} · {fmtDays(rows.reduce((a, r) => a + r.days, 0))} in total</div>
    </div>
  );
}
