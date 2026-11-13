// SQLite schema (kept as a TS string so esbuild bundles it into the backend).
// Bump SCHEMA_VERSION when a table changes: the cache is disposable — it is
// dropped and refilled by the next sync, BambooHR stays the system of record.
export const SCHEMA_VERSION = 2; // 2: team_member (several teams in one cache)

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS employee (
  id            TEXT PRIMARY KEY,   -- BambooHR employee id
  display_name  TEXT NOT NULL,
  team          TEXT,               -- squad from the local squads mapping
  location      TEXT,
  reports_to_id TEXT,
  in_scope      INTEGER NOT NULL    -- 1 if a member of a SELECTED team (see team_member)
);

-- who belongs to which team: the active reporting line of that team's key
CREATE TABLE IF NOT EXISTS team_member (
  team_id       TEXT NOT NULL,
  employee_id   TEXT NOT NULL,
  PRIMARY KEY (team_id, employee_id)
);

-- team names (mirrors teams.json; ord = selected teams first) so a person's
-- squad can default to their team's name, renames included
CREATE TABLE IF NOT EXISTS team_info (
  team_id       TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  ord           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS leave_request (
  id            TEXT PRIMARY KEY,   -- BambooHR request id
  employee_id   TEXT NOT NULL REFERENCES employee(id),
  bamboo_status TEXT NOT NULL,      -- approved | requested | denied | canceled | superceded
  type_id       TEXT NOT NULL,
  type_name     TEXT NOT NULL,
  start_date    TEXT NOT NULL,      -- YYYY-MM-DD, employee-local
  end_date      TEXT NOT NULL,
  amount        REAL,
  amount_unit   TEXT,
  requested_at  TEXT,
  synced_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leave_day (
  request_id    TEXT NOT NULL REFERENCES leave_request(id) ON DELETE CASCADE,
  employee_id   TEXT NOT NULL,
  day           TEXT NOT NULL,
  fraction      REAL NOT NULL,
  PRIMARY KEY (request_id, day)
);

CREATE TABLE IF NOT EXISTS holiday (day TEXT, location TEXT, name TEXT, PRIMARY KEY (day, location));
CREATE TABLE IF NOT EXISTS sprint  (id TEXT PRIMARY KEY, board TEXT, name TEXT, start_date TEXT, end_date TEXT);
CREATE TABLE IF NOT EXISTS leave_type (id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS saved_view (name TEXT PRIMARY KEY, filters_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_log (at TEXT, ok INTEGER, records INTEGER, error TEXT, duration_ms INTEGER);
CREATE TABLE IF NOT EXISTS setting (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS idx_day_emp ON leave_day(day, employee_id);
CREATE INDEX IF NOT EXISTS idx_req_status ON leave_request(bamboo_status, start_date);
CREATE INDEX IF NOT EXISTS idx_req_emp ON leave_request(employee_id);
`;
