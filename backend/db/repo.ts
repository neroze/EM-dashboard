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

/** a person's squad label: the manual squad mapping if set, otherwise the
 *  name of the team (API key) they belong to — selected teams first */
const teamOf = (t: string) => `COALESCE(${t}.team, (SELECT ti.name FROM team_member tm JOIN team_info ti ON ti.team_id = tm.team_id
  WHERE tm.employee_id = ${t}.id ORDER BY ti.ord LIMIT 1), 'Unassigned')`;
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
    db.exec('DROP TABLE IF EXISTS leave_day; DROP TABLE IF EXISTS leave_request; DROP TABLE IF EXISTS employee; DROP TABLE IF EXISTS team_member;' +
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
export function deleteSetting(key: string) { run('DELETE FROM setting WHERE key = ?', key); }

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

// ---- teams -------------------------------------------------------------------

/** one team's sync: upsert the directory, replace that team's membership
 *  (in my reporting line AND active), then drop leave nobody's team covers */
export function replaceTeamEmployees(teamId: string, list: Employee[]) {
  tx(() => {
    for (const e of list) {
      run(`INSERT INTO employee(id, display_name, team, location, reports_to_id, in_scope) VALUES (?,?,?,?,?,0)
           ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, team=excluded.team,
             location=excluded.location, reports_to_id=excluded.reports_to_id`,
        e.id, e.displayName, e.team, e.location, e.reportsToId);
    }
    run('DELETE FROM team_member WHERE team_id = ?', teamId);
    for (const e of list) if (e.inScope) run('INSERT OR IGNORE INTO team_member(team_id, employee_id) VALUES (?,?)', teamId, e.id);
    dropOrphanLeave();
  });
}

/** forget a team: its membership, and leave no remaining team covers */
export function removeTeamData(teamId: string) {
  tx(() => {
    run('DELETE FROM team_member WHERE team_id = ?', teamId);
    dropOrphanLeave();
  });
}

function dropOrphanLeave() {
  run('DELETE FROM leave_day WHERE employee_id NOT IN (SELECT employee_id FROM team_member)');
  run('DELETE FROM leave_request WHERE employee_id NOT IN (SELECT employee_id FROM team_member)');
}

/** in_scope = member of any of the given (selected) teams */
export function applyScope(teamIds: string[]) {
  const ph = teamIds.map(() => '?').join(',') || "''";
  db.prepare(`UPDATE employee SET in_scope = CASE WHEN id IN
    (SELECT employee_id FROM team_member WHERE team_id IN (${ph})) THEN 1 ELSE 0 END`).run(...teamIds);
}

export function teamMembers(teamId: string): { id: string; location: string }[] {
  return all(`SELECT e.id, COALESCE(e.location, '') AS location FROM team_member m JOIN employee e ON e.id = m.employee_id
    WHERE m.team_id = ?`, teamId);
}

/** the teams (of those given) an employee belongs to */
export function teamsOf(employeeId: string, among: string[]): string[] {
  return all('SELECT team_id AS t FROM team_member WHERE employee_id = ?', employeeId).map((r) => r.t as string).filter((t) => among.includes(t));
}

/** settings from a pre-multi-team per-team cache file */
export function readLegacySettings(path: string, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  try {
    const other = new Database(path);
    for (const k of keys) {
      const r = other.prepare('SELECT value_json FROM setting WHERE key = ?').all(k)[0];
      if (r) { try { out[k] = JSON.parse(r.value_json); } catch { /* skip */ } }
    }
    other.close();
  } catch { /* unreadable — the team just needs its first sync */ }
  return out;
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
export function replaceRequests(rows: LeaveRequestRow[], days: LeaveDayRow[], from: string, to: string, purgeBefore: string, teamId: string) {
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
    // only THIS team's people: another team's sync owns the rest
    const gone = `SELECT id FROM leave_request WHERE end_date >= ? AND start_date <= ? AND id NOT IN (SELECT id FROM keep_req)
      AND employee_id IN (SELECT employee_id FROM team_member WHERE team_id = ?)`;
    run(`DELETE FROM leave_day WHERE request_id IN (${gone})`, from, to, teamId);
    run(`DELETE FROM leave_request WHERE id IN (${gone})`, from, to, teamId);
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
  // selected teams only (in_scope), like every view
  const r = all(`SELECT
      (SELECT COUNT(*) FROM leave_request r JOIN employee e ON e.id = r.employee_id WHERE e.in_scope = 1) AS requests,
      (SELECT COUNT(*) FROM leave_day d JOIN employee e ON e.id = d.employee_id WHERE e.in_scope = 1) AS days,
      (SELECT COUNT(*) FROM employee WHERE in_scope = 1) AS people`)[0];
  return { requests: r.requests as number, days: r.days as number, people: r.people as number };
}

export interface ScopedPerson { id: string; displayName: string; team: string; location: string }

/** in-scope people after person/team/location filters */
export function people(f: Pick<Filters, 'people' | 'teams' | 'locations'> = {}): ScopedPerson[] {
  const where = ['in_scope = 1'];
  const p: unknown[] = [];
  inList(where, p, 'id', f.people);
  inList(where, p, teamOf('e'), f.teams);
  inList(where, p, "COALESCE(location, 'Unknown')", f.locations);
  return all(`SELECT id, display_name AS displayName, ${teamOf('e')} AS team,
      COALESCE(location, 'Unknown') AS location FROM employee e WHERE ${where.join(' AND ')}
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
  inList(where, p, teamOf('e'), f.teams);
  inList(where, p, "COALESCE(e.location, 'Unknown')", f.locations);
  if (f.requestedFrom) { where.push('r.requested_at >= ?'); p.push(f.requestedFrom); }
  if (f.requestedTo) { where.push('r.requested_at <= ?'); p.push(f.requestedTo); }
  return all(`SELECT r.id, r.employee_id AS employeeId, e.display_name AS person,
      ${teamOf('e')} AS team, COALESCE(e.location, 'Unknown') AS location,
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
    UNION SELECT DISTINCT r.type_id AS id, r.type_name AS name FROM leave_request r JOIN employee e ON e.id = r.employee_id
      WHERE e.in_scope = 1 AND r.type_id NOT IN (SELECT id FROM leave_type)
    ORDER BY name`);
}

export function distinct(col: 'team' | 'location'): string[] {
  const expr = col === 'team' ? teamOf('e') : "COALESCE(e.location, 'Unknown')";
  return all(`SELECT DISTINCT ${expr} AS v FROM employee e WHERE e.in_scope = 1 ORDER BY v`).map((r) => r.v);
}

/** each in-scope person's automatic squad: the name of their (first) team */
export function autoTeams(): Record<string, string> {
  return Object.fromEntries(all(`SELECT e.id, (SELECT ti.name FROM team_member tm JOIN team_info ti ON ti.team_id = tm.team_id
      WHERE tm.employee_id = e.id ORDER BY ti.ord LIMIT 1) AS t FROM employee e WHERE e.in_scope = 1`)
    .filter((r) => r.t).map((r) => [r.id, r.t]));
}

/** team name -> position (selected teams first) for grouping people */
export function teamOrder(): Map<string, number> {
  return new Map(all('SELECT name, ord FROM team_info').map((r) => [r.name as string, r.ord as number]));
}

/** mirror the team list (names + order) for the squad default above */
export function setTeamInfo(teams: { id: string; name: string }[]) {
  tx(() => {
    run('DELETE FROM team_info');
    teams.forEach((t, i) => run('INSERT INTO team_info(team_id, name, ord) VALUES (?,?,?)', t.id, t.name, i));
  });
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
