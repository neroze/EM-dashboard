// One row per request; the export writes exactly these rows in this order
// (both use backend/domain/sort.ts).
import { fmtDays, fmtShort, STATUS_LABEL } from '../format.ts';
import { setState, useUi } from '../state/filters.ts';
import type { LeaveRecord, SortKey } from '../types.ts';
import { openInBamboo } from '../bamboo-link.ts';
import { approveLeave } from '../approve.ts';

const COLS: { key: SortKey; label: string; cls?: string }[] = [
  { key: 'person', label: 'Person' },
  { key: 'team', label: 'Squad' },
  { key: 'status', label: 'Status' },
  { key: 'typeName', label: 'Type' },
  { key: 'startDate', label: 'Dates' },
  { key: 'days', label: 'Days', cls: 'num' },
  { key: 'requestAgeDays', label: 'Request age', cls: 'num' },
];

export function ListView({ rows }: { rows: LeaveRecord[] | null }) {
  const { sort } = useUi();
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
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.person}<div className="muted small">{r.location}</div></td>
              <td>{r.team}</td>
              <td><span className={'badge ' + r.status}>{STATUS_LABEL[r.status]}</span></td>
              <td>{r.typeName}</td>
              <td className="nowrap">{fmtShort(r.startDate)}{r.endDate !== r.startDate ? ` – ${fmtShort(r.endDate)}` : ''}</td>
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
      </table>
      {!rows.length && <div className="empty">No leave requests match these filters.</div>}
      <div className="list-foot muted small">{rows.length} request{rows.length === 1 ? '' : 's'} · {fmtDays(rows.reduce((a, r) => a + r.days, 0))} in total</div>
    </div>
  );
}
