// Shared record shapes. Pure types — imported by the backend and (type-only)
// by the UI through src/types.ts.

export type BambooStatus = 'approved' | 'requested' | 'denied' | 'canceled' | 'superceded';
export type AppStatus = 'planned' | 'draft' | 'denied' | 'canceled';

export interface Employee {
  id: string;
  displayName: string;
  team: string | null;
  location: string | null;
  reportsToId: string | null;
  /** still employed: BambooHR status Active and no termination date that has passed */
  active: boolean;
  inScope: boolean;
}

export interface LeaveRequestRow {
  id: string;
  employeeId: string;
  bambooStatus: string;
  typeId: string;
  typeName: string;
  startDate: string; // YYYY-MM-DD, employee-local
  endDate: string;
  amount: number | null;
  amountUnit: string | null;
  requestedAt: string | null;
  syncedAt: string;
}

export interface LeaveDayRow {
  requestId: string;
  employeeId: string;
  day: string;
  fraction: number; // 1 full day, 0.5 half day
}

export interface Holiday {
  day: string;
  location: string; // '*' = applies to everyone (company holiday)
  name: string;
}

export interface Sprint {
  id: string;
  board: string;
  name: string;
  startDate: string;
  endDate: string;
}

export interface Filters {
  from: string;
  to: string;
  statuses?: AppStatus[];
  types?: string[];
  people?: string[];
  teams?: string[];
  locations?: string[];
  minDays?: number | null;
  maxDays?: number | null;
  requestedFrom?: string | null;
  requestedTo?: string | null;
  overlapOnly?: boolean;
  /** with overlapOnly: a day counts when ≥ N people are out (else the team threshold) */
  overlapMinPeople?: number | null;
  sprint?: string | null; // sprint name — informational, from/to already carry it
}

export interface LeaveRecord {
  id: string;
  employeeId: string;
  person: string;
  team: string;
  location: string;
  status: AppStatus;
  bambooStatus: string;
  typeId: string;
  typeName: string;
  startDate: string;
  endDate: string;
  days: number; // working-day total (sum of leave_day fractions)
  amount: number | null;
  amountUnit: string | null;
  requestedAt: string | null;
  requestAgeDays: number | null;
  url: string;
}
