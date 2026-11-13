// UI-side shapes. Record types come straight from the backend (type-only
// imports — nothing from backend/ is bundled into the page).
export type { AppStatus, Filters, Holiday, LeaveRecord } from '../backend/domain/types.ts';
export type { OverlapDay, TeamCapacity } from '../backend/domain/capacity.ts';
export type { DailyPoint, KindTotals, PersonTotals, MonthSummary, QuarterSummary, YearSummary, Dashboard, DashItem, SprintLeave, SprintPerson, DashPeriod, DashSection, Ranked, SameDay } from '../backend/domain/dashboard.ts';
export type { LeaveRun, LongLeaveYear, MonthRuns } from '../backend/domain/longleave.ts';
export type { Sort, SortKey } from '../backend/domain/sort.ts';
import type { OverlapDay, TeamCapacity } from '../backend/domain/capacity.ts';
import type { Holiday, LeaveRecord } from '../backend/domain/types.ts';

export interface Status {
  configured: boolean;
  demo: boolean;
  companyDomain: string;
  syncing: boolean;
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  lastDurationMs: number | null;
  lastRecords: number | null;
  lastError: string | null;
  recordCount: number;
  peopleCount: number;
  team: Team;
  teams: Team[];
  selected: string[]; // teams being viewed (their union)
}

export interface Team { id: string; name: string; color: string }

export interface SprintInfo { name: string; startDate: string; endDate: string; boards: Record<string, string> }

export interface Lookups {
  teams: string[];
  locations: string[];
  types: { id: string; name: string }[];
  people: { id: string; name: string; team: string; location: string }[];
  sprints: SprintInfo[];
  today: string;
}

export interface CalendarCell { s: 'P' | 'D' | 'X'; f: number; t: string; id: string; w: 0 | 1 }
export interface CalendarData {
  people: { id: string; displayName: string; team: string; location: string }[];
  days: string[];
  cells: (CalendarCell | null)[][];
  holidays: Holiday[];
  load: OverlapDay[];
  requests: Record<string, LeaveRecord>;
}

export interface CapOnLeave {
  employeeId: string; person: string; team: string;
  planned: number; draft: number; first: string; last: string; types: string[]; url: string;
}
export interface CapacityPeriod {
  id: string; name: string; from: string; to: string;
  teams: (TeamCapacity & { overlapDays: number; threshold: number })[];
  onLeave: CapOnLeave[];
}

export interface Summary { peopleOutToday: number; draftRequests: number; oldestDraftDays: number; overlapDays: number }

export interface SavedView { name: string; filters: UiFilters }

/** what the filter bar holds; `preset` keeps saved views relative ("next sprint") */
export interface UiFilters {
  preset: string; // 'this-week' | 'this-sprint' | 'next-sprint' | 'next-6-weeks' | 'next-30' | 'next-90' | 'quarter' | 'sprint:<name>' | 'custom'
  from: string;
  to: string;
  statuses: ('planned' | 'draft' | 'denied' | 'canceled')[];
  types: string[];
  people: string[];
  teams: string[];
  locations: string[];
  duration: '' | 'half' | 'full' | 'week';
  requestedFrom: string;
  requestedTo: string;
  overlapOnly: boolean;
  overlapMinPeople: number | null;
}

export interface ResourceSnapshot {
  at: number;
  processes: { name: string; pid: number; role: string; rssMb: number; cpuPct: number; uptimeS: number }[];
  totals: { rssMb: number; cpuPct: number; count: number };
  attribution: string;
}
