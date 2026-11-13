// Thin typed wrapper over tiny.api.call. Every read goes to the backend's
// SQLite cache; only setup / syncNow / sendDigest touch the network.
import type {
  CalendarData, CapacityPeriod, Dashboard, LongLeaveYear, YearSummary, Filters, LeaveRecord, Lookups, OverlapDay, SavedView, Sort, Status, Summary, UiFilters,
} from './types.ts';

const call = <T>(method: string, params?: unknown): Promise<T> => tiny.api.call(method, params);

/** UI filter state -> the backend's Filters */
export function toFilters(f: UiFilters): Filters {
  const d = f.duration;
  return {
    from: f.from, to: f.to, statuses: f.statuses, types: f.types, people: f.people, teams: f.teams,
    locations: f.locations,
    minDays: d === 'full' ? 1 : d === 'week' ? 5 : null,
    maxDays: d === 'half' ? 0.5 : null,
    requestedFrom: f.requestedFrom || null, requestedTo: f.requestedTo || null,
    overlapOnly: f.overlapOnly, overlapMinPeople: f.overlapOnly ? f.overlapMinPeople : null,
    sprint: f.preset.startsWith('sprint:') ? f.preset.slice(7) : null,
  };
}

export const api = {
  setup: (companyDomain: string, apiKey: string, teamName?: string, color?: string) => call<{ ok: boolean; myEmployeeId: string }>('setup', { companyDomain, apiKey, teamName, color }),
  setupDemo: (teamName?: string, color?: string) => call<Status>('setupDemo', { teamName, color }),
  setTeamColor: (id: string, color: string) => call<Status>('setTeamColor', { id, color }),
  switchTeam: (id: string) => call<Status>('switchTeam', { id }),
  addTeam: (t: { name: string; companyDomain?: string; apiKey?: string; demo?: boolean; color?: string }) => call<Status>('addTeam', t),
  renameTeam: (name: string, id?: string) => call<Status>('renameTeam', { name, id }),
  selectTeams: (ids: string[]) => call<Status>('selectTeams', { ids }),
  removeTeam: (id?: string) => call<Status>('removeTeam', { id }),
  getStatus: () => call<Status>('getStatus'),
  syncNow: () => call<Status>('syncNow'),
  getSyncLog: () => call<{ at: string; ok: number; records: number; error: string | null; durationMs: number }[]>('getSyncLog'),
  getLeave: (f: UiFilters, sort?: Sort) => call<LeaveRecord[]>('getLeave', { filters: toFilters(f), sort }),
  getCalendar: (f: UiFilters) => call<CalendarData>('getCalendar', { filters: toFilters(f) }),
  getCapacity: (f: UiFilters, sprintId?: string | null, byMonth = false) => call<CapacityPeriod[]>('getCapacity', { filters: toFilters(f), sprintId, byMonth }),
  getOverlaps: (f: UiFilters, threshold?: number) => call<OverlapDay[]>('getOverlaps', { filters: toFilters(f), threshold }),
  getDashboard: (f: UiFilters) => call<Dashboard>('getDashboard', { filters: toFilters(f) }),
  getYearSummary: (f: UiFilters, year: number) => call<YearSummary>('getYearSummary', { filters: toFilters(f), year }),
  getLongLeave: (f: UiFilters, year: number) => call<LongLeaveYear>('getLongLeave', { filters: toFilters(f), year }),
  approveRequest: (id: string) => call<{ ok: boolean }>('approveRequest', { id }),
  getQuarterCapacity: (f: UiFilters, year: number, q: number) => call<QuarterCapacity>('getQuarterCapacity', { filters: toFilters(f), year, q }),
  getSummary: (f: UiFilters) => call<Summary>('getSummary', { filters: toFilters(f) }),
  getLookups: () => call<Lookups>('getLookups'),
  listViews: () => call<SavedView[]>('listViews'),
  saveView: (name: string, filters: UiFilters) => call<SavedView[]>('saveView', { name, filters }),
  deleteView: (name: string) => call<SavedView[]>('deleteView', { name }),
  exportCsv: (f: UiFilters, sort: Sort, path: string) => call<{ path: string; rows: number }>('exportCsv', { filters: toFilters(f), sort, path }),
  exportXlsx: (f: UiFilters, sort: Sort, path: string) => call<{ path: string; rows: number }>('exportXlsx', { filters: toFilters(f), sort, path }),
  getSettings: () => call<Settings>('getSettings'),
  saveSettings: (patch: Partial<Settings> & { slackWebhook?: string }) => call<Settings>('saveSettings', patch),
  getDigest: () => call<{ title: string; text: string }>('getDigest'),
  sendDigest: () => call<{ ok: boolean }>('sendDigest'),
  resourcesOpen: () => call<boolean>('resourcesOpen'),
  resourcesClose: () => call<boolean>('resourcesClose'),
  getResourceUsage: () => call<ResourceUsage>('getResourceUsage'),
  signOut: () => call<{ ok: boolean }>('signOut'),
};

export interface CapTotals { working: number; plannedOut: number; draftOut: number; wfh: number; available: number; ifDrafts: number; headcount: number }
export interface QuarterCapacity {
  year: number; q: number; from: string; to: string; today: string;
  total: CapTotals;
  months: (CapTotals & { month: string; from: string; to: string })[];
  teams: (CapTotals & { team: string })[];
}

export interface Settings {
  defaultThreshold: number;
  thresholds: Record<string, number>;
  linkTemplate: string;
  hoursPerDay: number;
  squads: string[];
  squadMap: Record<string, string>;
  people: { id: string; name: string; team: string | null; autoTeam: string | null }[];
  digest: { enabled: boolean; weekday: number; hour: number; lastSent: string | null };
  hasSlackWebhook: boolean;
}

export interface ResourceUsage {
  processes: { name: string; pid: number; role: string; rssMb: number; cpuPct: number; uptimeS: number }[];
  totals: { rssMb: number; cpuPct: number; count: number } | null;
  attribution: string | null;
  history: { at: number; rssMb: number; cpuPct: number }[];
  dbSizeMb: number;
  records: number;
  leaveDays: number;
  people: number;
  lastSync: { at: string; durationMs: number; records: number } | null;
}
