// Row ordering + export columns, shared by the List view and the exporter so
// a CSV/Excel file is exactly the rows (and order) on screen. Pure.
import type { LeaveRecord } from './types.ts';

export type SortKey = 'startDate' | 'status' | 'person' | 'typeName' | 'days' | 'requestAgeDays' | 'team';
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }
export const DEFAULT_SORT: Sort = { key: 'startDate', dir: 'asc' };

const STATUS_ORDER: Record<string, number> = { draft: 0, planned: 1, denied: 2, canceled: 3 };

export function sortRecords(rows: LeaveRecord[], sort: Sort = DEFAULT_SORT): LeaveRecord[] {
  const k = sort.key;
  const m = sort.dir === 'desc' ? -1 : 1;
  const val = (r: LeaveRecord): string | number =>
    k === 'status' ? STATUS_ORDER[r.status] ?? 9
      : k === 'days' ? r.days
        : k === 'requestAgeDays' ? r.requestAgeDays ?? -1
          : String(r[k] ?? '');
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return c * m || a.startDate.localeCompare(b.startDate) || a.person.localeCompare(b.person) || a.id.localeCompare(b.id);
  });
}

export const STATUS_LABEL: Record<string, string> = { planned: 'Planned', draft: 'Draft', denied: 'Denied', canceled: 'Canceled' };

export const EXPORT_COLUMNS: { header: string; get: (r: LeaveRecord) => string | number }[] = [
  { header: 'Person', get: (r) => r.person },
  { header: 'Squad', get: (r) => r.team },
  { header: 'Location', get: (r) => r.location },
  { header: 'Status', get: (r) => STATUS_LABEL[r.status] ?? r.status },
  { header: 'Leave type', get: (r) => r.typeName },
  { header: 'Start', get: (r) => r.startDate },
  { header: 'End', get: (r) => r.endDate },
  { header: 'Working days', get: (r) => r.days },
  { header: 'Requested', get: (r) => r.requestedAt ?? '' },
  { header: 'Request age (days)', get: (r) => r.requestAgeDays ?? '' },
  { header: 'BambooHR', get: (r) => r.url },
];
