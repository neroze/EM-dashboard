// BambooHR JSON -> internal records. Pure functions: no tjs, no I/O, so the
// unit tests run them under plain node. Response shapes follow BambooHR's
// public API docs (verify against a live response before trusting a field).
//
// Data minimisation: only id, display name, location, manager id, request
// dates/status/type/amount are kept. Request notes/comments, balances,
// contact details are dropped here and never reach SQLite.
import { eachDay, isDate, isWeekend, today } from '../domain/dates.ts';
import type { Employee, Holiday, LeaveDayRow, LeaveRequestRow } from '../domain/types.ts';

const str = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);

/** still employed on `t`? BambooHR's `status` is "Active" / "Inactive" (the
 *  directory endpoint omits it — it only lists active people anyway). A
 *  termination date only counts once it has passed: someone serving notice
 *  stays visible until their last day. */
export function isActiveEmployee(e: any, t: string): boolean {
  const status = str(e?.status ?? e?.employmentStatus);
  if (status && status.toLowerCase() !== 'active') return false;
  const term = str(e?.terminationDate);
  if (term && isDate(term) && term !== '0000-00-00' && term < t) return false;
  return true;
}

/** custom report (POST reports/custom) or directory (GET employees/directory) */
export function mapEmployees(json: any, t: string = today()): Employee[] {
  const list: any[] = Array.isArray(json?.employees) ? json.employees : Array.isArray(json) ? json : [];
  const out: Employee[] = [];
  for (const e of list) {
    const id = str(e?.id);
    if (!id) continue;
    const name = str(e.displayName)
      ?? ([e.preferredName || e.firstName, e.lastName].filter(Boolean).join(' ') || `Employee ${id}`);
    out.push({
      id,
      displayName: name,
      team: null, // squad comes from the local squads mapping, not BambooHR
      location: str(e.location),
      // supervisorEId = the manager's employee id; supervisorId is their
      // employee NUMBER in some tenants, so it is only a fallback (verify)
      reportsToId: str(e.supervisorEId) ?? str(e.supervisorId) ?? null,
      active: isActiveEmployee(e, t),
      inScope: false,
    });
  }
  return out;
}

export function mapTypes(json: any): { id: string; name: string }[] {
  const list: any[] = Array.isArray(json?.timeOffTypes) ? json.timeOffTypes : Array.isArray(json) ? json : [];
  return list
    .filter((t) => str(t?.id) && str(t?.name))
    .map((t) => ({ id: String(t.id), name: String(t.name) }));
}

export function mapRequest(raw: any, syncedAt: string): LeaveRequestRow | null {
  const id = str(raw?.id);
  const employeeId = str(raw?.employeeId);
  const start = raw?.start, end = raw?.end;
  if (!id || !employeeId || !isDate(start) || !isDate(end)) return null;
  const status = typeof raw.status === 'object' ? raw.status?.status : raw.status;
  const amount = raw.amount && raw.amount.amount !== undefined ? Number(raw.amount.amount) : null;
  return {
    id,
    employeeId,
    bambooStatus: String(status || 'requested').toLowerCase(),
    typeId: str(raw.type?.id) ?? 'unknown',
    typeName: str(raw.type?.name) ?? 'Unknown',
    startDate: start,
    endDate: end < start ? start : end,
    amount: Number.isFinite(amount) ? amount : null,
    amountUnit: str(raw.amount?.unit),
    requestedAt: isDate(raw.created) ? raw.created : null,
    syncedAt,
  };
}

/** per-day amounts BambooHR attaches to a request: { 'YYYY-MM-DD': '8' } */
export function requestDates(raw: any): Record<string, number> | null {
  if (!raw?.dates || typeof raw.dates !== 'object') return null;
  const out: Record<string, number> = {};
  for (const [d, v] of Object.entries(raw.dates)) {
    const n = Number(v);
    if (isDate(d) && Number.isFinite(n)) out[d] = n;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * One row per working person-day. Weekends and the employee's holidays are
 * skipped. Half days come from BambooHR's per-day amounts when present
 * (hours are divided by hoursPerDay), else from a single-day request whose
 * total amount is under one day.
 */
export function expandDays(
  req: LeaveRequestRow,
  dates: Record<string, number> | null,
  isHoliday: (day: string) => boolean,
  hoursPerDay = 8,
): LeaveDayRow[] {
  const toFraction = (v: number) =>
    Math.max(0, Math.min(1, req.amountUnit === 'hours' ? v / hoursPerDay : v));
  const rows: LeaveDayRow[] = [];
  const push = (day: string, fraction: number) => {
    if (fraction <= 0 || isWeekend(day) || isHoliday(day)) return;
    rows.push({ requestId: req.id, employeeId: req.employeeId, day, fraction: Math.round(fraction * 100) / 100 });
  };
  if (dates) {
    for (const day of Object.keys(dates).sort()) push(day, toFraction(dates[day]));
    return rows;
  }
  const days = eachDay(req.startDate, req.endDate);
  if (days.length === 1 && req.amount !== null && req.amount > 0) {
    push(days[0], toFraction(req.amount));
    return rows;
  }
  for (const day of days) push(day, 1);
  return rows;
}

/** holiday entries out of GET time_off/whos_out (time-off entries ignored) */
export function mapHolidays(json: any): Holiday[] {
  const list: any[] = Array.isArray(json) ? json : [];
  const out: Holiday[] = [];
  for (const h of list) {
    if (h?.type !== 'holiday' || !isDate(h.start)) continue;
    const end = isDate(h.end) && h.end >= h.start ? h.end : h.start;
    for (const day of eachDay(h.start, end)) {
      // whos_out holidays carry no location: company-wide ('*'). Per-location
      // holidays can be added through resources/config/holidays.json.
      out.push({ day, location: '*', name: String(h.name || 'Holiday') });
    }
  }
  return out;
}
