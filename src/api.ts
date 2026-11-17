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
  getProjects: () => call<ProjectsData>('getProjects'),
  getAllocation: () => call<AllocationData>('getAllocation'),
  saveProject: (p: ProjectInput) => call<{ id: string; warning: string | null }>('saveProject', p),
  deleteProject: (id: string) => call<{ ok: boolean }>('deleteProject', { id }),
  refreshProjects: (id?: string) => call<{ refreshed: number; errors: string[] }>('refreshProjects', { id }),
  getForecastReport: (id: string, compareWith: string | null) => call<ForecastReport>('getForecastReport', { id, compareWith }),
  importRun: (id: string, text: string) => call<{ date: string; tickets: number }>('importRun', { id, text }),
  deleteRun: (id: string, date: string) => call<{ ok: boolean }>('deleteRun', { id, date }),
  linkPerson: (accountId: string, employeeId: string) => call<{ ok: boolean }>('linkPerson', { accountId, employeeId }),
  getJiraStatus: () => call<JiraStatus>('getJiraStatus'),
  setJira: (site: string, email: string, token: string) => call<JiraStatus>('setJira', { site, email, token }),
  clearJira: () => call<JiraStatus>('clearJira'),
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

export type BandName = 'green' | 'amber' | 'red';
export type Finish = string | null | 'never';
export interface WorkTotals { original: number; current: number; done: number; remaining: number; tickets: number; open: number; unestimated: number }
export interface PTicket {
  key: string; summary: string; status: string; done: boolean; epicKey: string;
  assigneeId: string | null; assigneeName: string | null;
  originalDays: number | null; remainingDays: number | null;
  sprint: { name: string; state: 'active' | 'future' | 'closed'; startDate: string | null; endDate: string | null } | null;
  rank: number; finish: Finish;
  /** Jira issue type (Story, Task, Bug, Sub-task…); absent until the next refresh */
  type?: string; subtask?: boolean;
}
export interface PPerson {
  id: string; name: string; accountId: string | null; matched: 'manual' | 'email' | 'name' | 'none';
  working: number; leave: number; available: number; burned: number;
  workingAhead: number; leaveAhead: number; availableAhead: number; leaveDatesAhead: LeaveDate[];
  remaining: number; done: number; openTickets: number; active: boolean;
  utilisation: number | null; band: BandName; finish: Finish; lateDays: number | null;
}
export interface PEpic {
  key: string; summary: string; status: string; done: boolean; dueDate: string;
  estimateDays?: number | null; // set on the epic itself in Jira
  quarters?: string[];          // quarter labels, e.g. ["Q3-2026", "Q4-2026"]
  /** closed epic: its tickets left open in Jira, closed out with it (not remaining, not delivered) */
  closedOut?: { tickets: number; days: number; keys: string[]; subtasks: number; parents: string[] } | null;
  totals: WorkTotals; finish: Finish; lateDays: number | null; health: BandName;
}
export interface LeaveDate { day: string; out: number }
/** the measurement baseline: the project issue's original estimate (else its epics' own estimates) vs the tickets' estimate now */
export interface Baseline {
  days: number | null; source: 'project' | 'epics' | null; epicSum: number | null;
  tickets: number; growth: number | null; growthPct: number | null;
  fetched: boolean; // false: the Jira snapshot predates reading estimates — refresh
}
export interface PSprint {
  name: string; startDate: string; endDate: string; state: 'past' | 'active' | 'future';
  working: number; leave: number; available: number;
  elapsed: number; elapsedPct: number; burnedPct: number; pace: 'ahead' | 'on-pace' | 'behind' | null;
  committed: number; done: number; remaining: number; tickets: number; open: number;
  forecast: number; forecastOthers: number; assignedPeople: number;
  utilisation: number | null; band: BandName; forecastUtilisation: number | null; afterDeadline: boolean; beforeStart: boolean;
  people: { id: string; working: number; leave: number; available: number; elapsed: number; committed: number; remaining: number; done: number; burnedPct: number; forecast: number; assigned: boolean; leaveDates: LeaveDate[]; utilisation: number | null; band: BandName }[];
}
export interface ReportEpicRow { key: string; label: string; est: number; done: number; review: number; rem: number; unest: number }
export interface ForecastReport {
  epics: ReportEpicRow[]; total: ReportEpicRow;
  sprints: { name: string; label: string; days: number; capacity: number; loaded: number; needed: number; utilisation: number | null }[];
  notInSprint: number; engineers: number; totalCapacity: number; totalRemaining: number; totalUtilisation: number | null;
  changes: null | { rows: { label: string; count: number; keys: string; effect: number; standard: boolean }[]; prevTotal: number; prevDate: string };
  warnings: string[]; snapshot: unknown; markdown: string; compareWith: string | null;
  loadByPerson: Record<string, { sprints: number[]; none: number }>;
  engineerRows: { id: string; name: string; leaveKnown: boolean; sprints: { working: number; leave: number; available: number; actual: number; leaveDates: LeaveDate[] }[] }[];
  /** actual available capacity per sprint (Σ engineers' available, each capped at schedulableCap a sprint) */
  actualBySprint: number[]; schedulableCap: number;
  /** rows of the epics left out of the project (unticked) — shown, never totalled */
  excludedRows?: ReportEpicRow[];
}
export interface ProjectHealth {
  id: string; key: string; name: string; startDate: string; deadline: string;
  /** the name typed in Edit ('' = shown name is the idea's Jira title) — what a save must send back */
  ownName: string;
  /** what the project pulls (set in Edit), and how the last pull read it */
  track: ProjectTrack; tracked: 'idea' | 'epic' | null; issueType: string | null;
  ideaStatus: string | null; fetchedAt: string | null; error: string | null; today: string;
  runs: { date: string; rt: number | null; tickets: number }[];
  linkedEpics: LinkedEpic[];
  report: ForecastReport | null;
  health: null | {
    totals: WorkTotals; scopeGrowth: number;
    baseline: Baseline;
    /** tickets' estimate by the epics' quarter labels; empty when no epic has one */
    quarters: { quarter: string | null; epics: string[]; tickets: number; estimate: number; done: number; remaining: number }[];
    working: number; leave: number; available: number; burned: number; availableAhead: number; leaveAhead: number;
    capacityUsedPct: number; workDonePct: number; carriedIn: number; windowDonePct: number; firstWorkDate: string | null;
    workDone: number; workTaken: number; deliveredToday: number; team: number; progressFrom: string; delivered: number; estimate: number;
    utilisation: number | null; band: BandName;
    pace: { rate: number; capacityNeeded: number } | null;
    finish: Finish; lateDays: number | null; pooledFinish: Finish; status: BandName;
    people: PPerson[];
    unassigned: { remaining: number; tickets: number };
    epics: PEpic[];
    tickets: PTicket[];
    sprints: {
      sprints: PSprint[];
      backlog: { remaining: number; tickets: number };
      unmapped: { remaining: number; tickets: number; names: string[] };
    };
  };
}
export interface AllocItem { epicKey: string; jira: number; done: number; remaining: number; tickets: number; open: number }
export interface AllocCell {
  working: number; leave: number; available: number; leaveDates: LeaveDate[];
  jira: number; done: number; remaining: number; tickets: number; open: number;
  load: number | null; band: BandName; availableAhead: number | null; loadAhead: number | null;
  items: AllocItem[];
}
export interface AllocationData {
  jiraSite: string | null; today: string;
  projects: { id: string; name: string; deadline: string }[];
  missing: string[];
  sprints: { name: string; startDate: string; endDate: string; state: 'past' | 'active' | 'future' }[];
  people: {
    id: string; name: string; leaveKnown: boolean; cells: AllocCell[];
    backlog: { remaining: number; tickets: number; items: AllocItem[] };
    epics: string[]; projects: string[];
  }[];
  epics: { key: string; summary: string; status: string; done: boolean; projects: { id: string; name: string }[] }[];
  unassigned: { jira: number; remaining: number; tickets: number }[];
  unassignedBacklog: { remaining: number; tickets: number };
}
export interface ProjectsData { jiraSite: string | null; projects: ProjectHealth[]; people: { id: string; name: string }[] }
export interface LinkedEpic { key: string; summary: string; status: string; excluded: boolean; done?: boolean; estimateDays?: number | null; quarters?: string[] }
export type ProjectTrack = 'auto' | 'idea' | 'epic';
export interface ProjectInput {
  id?: string; key: string; name: string; startDate: string; deadline: string;
  track?: ProjectTrack;
  excludedEpics?: string[];
  /** editor only: the idea's linked epics to choose from */
  linkedEpics?: LinkedEpic[];
  /** editor only: how the last pull read the key */
  tracked?: 'idea' | 'epic' | null; issueType?: string | null;
}

export interface JiraStatus { configured: boolean; site: string | null; email: string | null }

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
