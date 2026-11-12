// Every SQLite read/write the api uses. tjs:sqlite is fully synchronous:
// never await a statement; .all() returns rows, .run() returns nothing.
import { Database } from 'tjs:sqlite';
import { bambooStatusesFor } from '../domain/status.ts';
import type { Employee, Filters, Holiday, LeaveDayRow, LeaveRequestRow, Sprint } from '../domain/types.ts';
import { SCHEMA, SCHEMA_VERSION } from './schema.ts';

let db: any = null;
export let dbPath = '';

const cache = new Map<string, any>();
function q(sql: string): any {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}
const all = (sql: string, ...p: unknown[]): any[] => q(sql).all(...p);
const run = (sql: string, ...p: unknown[]): void => { q(sql).run(...p); };

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function open(path: string) {
  dbPath = path;
  db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;');
  const v = db.prepare('PRAGMA user_version').all()[0]?.user_version ?? 0;
  if (v !== 0 && v !== SCHEMA_VERSION) {
    // cache is disposable: drop synced tables, keep saved views + settings
    db.exec('DROP TABLE IF EXISTS leave_day; DROP TABLE IF EXISTS leave_request; DROP TABLE IF EXISTS employee;' +
      'DROP TABLE IF EXISTS holiday; DROP TABLE IF EXISTS sprint; DROP TABLE IF EXISTS leave_type; DROP TABLE IF EXISTS sync_log;');
  }
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

export function close() {
  for (const s of cache.values()) { try { s.finalize(); } catch { /* already gone */ } }
  cache.clear();
  try { db?.close(); } catch { /* closed */ }
  db = null;
}

/** empty every synced table (switching between demo and a real account) */
export function wipeCache() {
  db.exec(`DELETE FROM leave_day; DELETE FROM leave_request; DELETE FROM employee; DELETE FROM holiday;
    DELETE FROM leave_type; DELETE FROM sync_log;
    DELETE FROM setting WHERE key IN ('employeesSyncedAt', 'metaSyncedAt', 'myEmployeeId');`);
}

// ---- settings -------------------------------------------------------------

export function getSetting<T>(key: string, fallback: T): T {
  const r = all('SELECT value_json FROM setting WHERE key = ?', key)[0];
  if (!r) return fallback;
  try { return JSON.parse(r.value_json) as T; } catch { return fallback; }
}
export function setSetting(key: string, value: unknown) {
  run('INSERT INTO setting(key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
    key, JSON.stringify(value));
}

// ---- sync writes ----------------------------------------------------------

export function replaceEmployees(list: Employee[]) {
  tx(() => {
    run('CREATE TEMP TABLE IF NOT EXISTS keep_emp (id TEXT PRIMARY KEY)');
    run('DELETE FROM keep_emp');
    for (const e of list) {
      run(`INSERT INTO employee(id, display_name, team, location, reports_to_id, in_scope) VALUES (?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, team=excluded.team,
             location=excluded.location, reports_to_id=excluded.reports_to_id, in_scope=excluded.in_scope`,
        e.id, e.displayName, e.team, e.location, e.reportsToId, e.inScope ? 1 : 0);
      run('INSERT OR IGNORE INTO keep_emp(id) VALUES (?)', e.id);
    }
    // people who left the directory: drop them and their leave
    run('DELETE FROM leave_request WHERE employee_id NOT IN (SELECT id FROM keep_emp)');
    run('DELETE FROM leave_day WHERE employee_id NOT IN (SELECT id FROM keep_emp)');
    run('DELETE FROM employee WHERE id NOT IN (SELECT id FROM keep_emp)');
  });
}

/** re-applies the squad mapping without a network round-trip */
export function applySquads(squads: Record<string, string>) {
  tx(() => {
    run('UPDATE employee SET team = NULL');
    for (const [id, team] of Object.entries(squads)) run('UPDATE employee SET team = ? WHERE id = ?', team, id);
  });
}

export function replaceTypes(list: { id: string; name: string }[]) {
  tx(() => {
    run('DELETE FROM leave_type');
    for (const t of list) run('INSERT OR REPLACE INTO leave_type(id, name) VALUES (?, ?)', t.id, t.name);
  });
}

export function replaceHolidays(list: Holiday[], from: string, to: string) {
  tx(() => {
    run('DELETE FROM holiday WHERE day BETWEEN ? AND ?', from, to);
    for (const h of list) run('INSERT OR REPLACE INTO holiday(day, location, name) VALUES (?,?,?)', h.day, h.location, h.name);
  });
}

export function replaceSprints(list: Sprint[]) {
  tx(() => {
    run('DELETE FROM sprint');
    for (const s of list) run('INSERT OR REPLACE INTO sprint(id, board, name, start_date, end_date) VALUES (?,?,?,?,?)',
      s.id, s.board, s.name, s.startDate, s.endDate);
  });
}

/**
 * Upsert the window's requests in one transaction; requests in the window
 * that BambooHR no longer returns are removed; leave_day rows are rebuilt for
 * every upserted request; anything ending before purgeBefore is purged.
 */
export function replaceRequests(rows: LeaveRequestRow[], days: LeaveDayRow[], from: string, to: string, purgeBefore: string) {
  tx(() => {
    run('CREATE TEMP TABLE IF NOT EXISTS keep_req (id TEXT PRIMARY KEY)');
    run('DELETE FROM keep_req');
    for (const r of rows) {
      run(`INSERT INTO leave_request(id, employee_id, bamboo_status, type_id, type_name, start_date, end_date,
             amount, amount_unit, requested_at, synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET employee_id=excluded.employee_id, bamboo_status=excluded.bamboo_status,
             type_id=excluded.type_id, type_name=excluded.type_name, start_date=excluded.start_date,
             end_date=excluded.end_date, amount=excluded.amount, amount_unit=excluded.amount_unit,
             requested_at=excluded.requested_at, synced_at=excluded.synced_at`,
        r.id, r.employeeId, r.bambooStatus, r.typeId, r.typeName, r.startDate, r.endDate,
        r.amount, r.amountUnit, r.requestedAt, r.syncedAt);
      run('INSERT OR IGNORE INTO keep_req(id) VALUES (?)', r.id);
    }
    const gone = 'SELECT id FROM leave_request WHERE end_date >= ? AND start_date <= ? AND id NOT IN (SELECT id FROM keep_req)';
    run(`DELETE FROM leave_day WHERE request_id IN (${gone})`, from, to);
    run(`DELETE FROM leave_request WHERE id IN (${gone})`, from, to);
    run('DELETE FROM leave_day WHERE request_id IN (SELECT id FROM keep_req)');
    for (const d of days) run('INSERT OR REPLACE INTO leave_day(request_id, employee_id, day, fraction) VALUES (?,?,?,?)',
      d.requestId, d.employeeId, d.day, d.fraction);
    // retention: nothing older than 3 months past its end date
    run('DELETE FROM leave_day WHERE request_id IN (SELECT id FROM leave_request WHERE end_date < ?)', purgeBefore);
    run('DELETE FROM leave_request WHERE end_date < ?', purgeBefore);
    run('DELETE FROM holiday WHERE day < ?', purgeBefore);
  });
}

export function logSync(at: string, ok: boolean, records: number, error: string | null, durationMs: number) {
  run('INSERT INTO sync_log(at, ok, records, error, duration_ms) VALUES (?,?,?,?,?)', at, ok ? 1 : 0, records, error, durationMs);
  run('DELETE FROM sync_log WHERE rowid NOT IN (SELECT rowid FROM sync_log ORDER BY at DESC LIMIT 200)');
}

// ---- reads ----------------------------------------------------------------

export function lastSync(): { at: string; ok: number; records: number; error: string | null; duration_ms: number } | null {
  return all('SELECT * FROM sync_log ORDER BY at DESC LIMIT 1')[0] ?? null;
}
export function lastGoodSync(): { at: string; records: number; duration_ms: number } | null {
  return all('SELECT * FROM sync_log WHERE ok = 1 ORDER BY at DESC LIMIT 1')[0] ?? null;
}
export function syncLog(limit = 20) {
  return all('SELECT at, ok, records, error, duration_ms AS durationMs FROM sync_log ORDER BY at DESC LIMIT ?', limit);
}
export function counts() {
  const r = all(`SELECT (SELECT COUNT(*) FROM leave_request) AS requests, (SELECT COUNT(*) FROM leave_day) AS days,
    (SELECT COUNT(*) FROM employee WHERE in_scope = 1) AS people`)[0];
  return { requests: r.requests as number, days: r.days as number, people: r.people as number };
}

export interface ScopedPerson { id: string; displayName: string; team: string; location: string }

/** in-scope people after person/team/location filters */
export function people(f: Pick<Filters, 'people' | 'teams' | 'locations'> = {}): ScopedPerson[] {
  const where = ['in_scope = 1'];
  const p: unknown[] = [];
  inList(where, p, 'id', f.people);
  inList(where, p, "COALESCE(team, 'Unassigned')", f.teams);
  inList(where, p, "COALESCE(location, 'Unknown')", f.locations);
  return all(`SELECT id, display_name AS displayName, COALESCE(team, 'Unassigned') AS team,
      COALESCE(location, 'Unknown') AS location FROM employee WHERE ${where.join(' AND ')}
      ORDER BY team, display_name`, ...p);
}

export function allEmployees(): { id: string; displayName: string; team: string | null; location: string | null; reportsToId: string | null; inScope: number }[] {
  return all(`SELECT id, display_name AS displayName, team, location, reports_to_id AS reportsToId, in_scope AS inScope
    FROM employee ORDER BY display_name`);
}

function inList(where: string[], params: unknown[], col: string, vals?: unknown[] | null) {
  if (!vals || !vals.length) return;
  where.push(`${col} IN (${vals.map(() => '?').join(',')})`);
  params.push(...vals);
}

export interface RequestQueryRow {
  id: string; employeeId: string; person: string; team: string; location: string;
  bambooStatus: string; typeId: string; typeName: string; startDate: string; endDate: string;
  amount: number | null; amountUnit: string | null; requestedAt: string | null; days: number;
}

/** requests overlapping [from, to] matching every SQL-expressible filter */
export function requests(f: Filters): RequestQueryRow[] {
  const where = ['e.in_scope = 1', 'r.end_date >= ?', 'r.start_date <= ?'];
  const p: unknown[] = [f.from, f.to];
  inList(where, p, 'r.bamboo_status', bambooStatusesFor(f.statuses));
  inList(where, p, 'r.type_id', f.types);
  inList(where, p, 'r.employee_id', f.people);
  inList(where, p, "COALESCE(e.team, 'Unassigned')", f.teams);
  inList(where, p, "COALESCE(e.location, 'Unknown')", f.locations);
  if (f.requestedFrom) { where.push('r.requested_at >= ?'); p.push(f.requestedFrom); }
  if (f.requestedTo) { where.push('r.requested_at <= ?'); p.push(f.requestedTo); }
  return all(`SELECT r.id, r.employee_id AS employeeId, e.display_name AS person,
      COALESCE(e.team, 'Unassigned') AS team, COALESCE(e.location, 'Unknown') AS location,
      r.bamboo_status AS bambooStatus, r.type_id AS typeId, r.type_name AS typeName,
      r.start_date AS startDate, r.end_date AS endDate, r.amount, r.amount_unit AS amountUnit,
      r.requested_at AS requestedAt,
      (SELECT COALESCE(SUM(d.fraction), 0) FROM leave_day d WHERE d.request_id = r.id) AS days
    FROM leave_request r JOIN employee e ON e.id = r.employee_id
    WHERE ${where.join(' AND ')}
    ORDER BY r.start_date, e.display_name`, ...p);
}

/** one request + whether its person is in my scope (for write checks) */
export function requestById(id: string): { id: string; employeeId: string; bambooStatus: string; inScope: number } | null {
  return all(`SELECT r.id, r.employee_id AS employeeId, r.bamboo_status AS bambooStatus, e.in_scope AS inScope
    FROM leave_request r JOIN employee e ON e.id = r.employee_id WHERE r.id = ?`, id)[0] ?? null;
}

/** reflect a status change made in BambooHR without waiting for the next sync */
export function setRequestStatus(id: string, bambooStatus: string) {
  run('UPDATE leave_request SET bamboo_status = ? WHERE id = ?', bambooStatus, id);
}

export interface DayQueryRow { requestId: string; employeeId: string; day: string; fraction: number; bambooStatus: string; typeName: string }

/** leave days in [from, to] for in-scope people, optionally limited to statuses */
export function days(from: string, to: string, bambooStatuses?: string[]): DayQueryRow[] {
  const where = ['e.in_scope = 1', 'd.day BETWEEN ? AND ?'];
  const p: unknown[] = [from, to];
  inList(where, p, 'r.bamboo_status', bambooStatuses);
  return all(`SELECT d.request_id AS requestId, d.employee_id AS employeeId, d.day, d.fraction,
      r.bamboo_status AS bambooStatus, r.type_name AS typeName
    FROM leave_day d JOIN leave_request r ON r.id = d.request_id JOIN employee e ON e.id = d.employee_id
    WHERE ${where.join(' AND ')}`, ...p);
}

/** earliest leave day in the cache (the sync window's lower edge, roughly) */
export function earliestDay(): string | null {
  return (all('SELECT MIN(day) AS d FROM leave_day')[0]?.d as string | null) ?? null;
}

export function holidays(from: string, to: string): Holiday[] {
  return all('SELECT day, location, name FROM holiday WHERE day BETWEEN ? AND ? ORDER BY day', from, to);
}

export function sprints(): Sprint[] {
  return all(`SELECT id, board, name, start_date AS startDate, end_date AS endDate FROM sprint ORDER BY start_date, board`);
}

export function leaveTypes(): { id: string; name: string }[] {
  // BambooHR's list, plus any type seen on a request but missing from it
  return all(`SELECT id, name FROM leave_type
    UNION SELECT DISTINCT type_id AS id, type_name AS name FROM leave_request WHERE type_id NOT IN (SELECT id FROM leave_type)
    ORDER BY name`);
}

export function distinct(col: 'team' | 'location'): string[] {
  const fallback = col === 'team' ? 'Unassigned' : 'Unknown';
  return all(`SELECT DISTINCT COALESCE(${col}, '${fallback}') AS v FROM employee WHERE in_scope = 1 ORDER BY v`).map((r) => r.v);
}

// ---- saved views ----------------------------------------------------------

export function listViews(): { name: string; filters: unknown }[] {
  return all('SELECT name, filters_json FROM saved_view ORDER BY name').map((r) => {
    let filters: unknown = {};
    try { filters = JSON.parse(r.filters_json); } catch { /* corrupt row: empty */ }
    return { name: r.name, filters };
  });
}
export function saveView(name: string, filters: unknown) {
  run('INSERT INTO saved_view(name, filters_json) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET filters_json = excluded.filters_json',
    name, JSON.stringify(filters));
}
export function deleteView(name: string) { run('DELETE FROM saved_view WHERE name = ?', name); }
