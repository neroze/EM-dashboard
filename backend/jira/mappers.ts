// Jira issue JSON → the few fields the project board uses. Pure.
// Estimates come from time tracking in seconds; the team estimates in
// 6-hour days, so 1 day = 6 h (Jira's own display may assume 8 h — ignored).
import type { ProjectEpic, Sprint, Ticket } from '../domain/projectHealth.ts';

export const ESTIMATE_HOURS_PER_DAY = 6;
export const JIRA_KEY = /^[A-Z][A-Z0-9_]{0,19}-\d{1,9}$/;

const days = (sec: unknown): number | null =>
  typeof sec === 'number' && Number.isFinite(sec) && sec >= 0 ? Math.round((sec / 3600 / ESTIMATE_HOURS_PER_DAY) * 100) / 100 : null;
const date = (s: unknown): string | null => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

export interface Assignee { accountId: string; name: string | null; email: string | null }

// own estimates only: sub-tasks are fetched as tickets of their own (as the forecast skill does)
export const TICKET_FIELDS = ['summary', 'status', 'assignee', 'parent', 'issuetype', 'resolution', 'resolutiondate', 'timeoriginalestimate', 'timeestimate'];
export const EPIC_FIELDS = ['summary', 'status', 'duedate', 'timeoriginalestimate', 'labels'];

/** every sprint in Jira's sprint field */
export function allSprints(raw: unknown): Sprint[] {
  return (Array.isArray(raw) ? raw : []).filter((s: any) => s && typeof s.name === 'string')
    .map((s: any): Sprint => ({ id: s.id === undefined || s.id === null ? null : String(s.id), name: s.name, state: s.state === 'active' || s.state === 'future' ? s.state : 'closed', startDate: date(s.startDate), endDate: date(s.endDate) }));
}

/** a ticket's sprint: the active one, else the next future one, else the last closed */
export function pickSprint(raw: unknown): Sprint | null {
  const list = allSprints(raw);
  return list.find((s) => s.state === 'active')
    ?? list.filter((s) => s.state === 'future').sort((a, b) => (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999'))[0]
    ?? list.filter((s) => s.state === 'closed').sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? ''))[0]
    ?? null;
}

const secs = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** a ticket or sub-task, with its OWN estimate (sub-tasks are separate tickets) */
export function mapTicket(raw: any, rank: number, sprintField: string | null): (Ticket & { assignee: Assignee | null }) | null {
  const f = raw?.fields;
  if (typeof raw?.key !== 'string' || !f) return null;
  const a = f.assignee?.accountId
    ? { accountId: String(f.assignee.accountId), name: f.assignee.displayName ? String(f.assignee.displayName) : null, email: f.assignee.emailAddress ? String(f.assignee.emailAddress) : null }
    : null;
  return {
    key: raw.key,
    summary: String(f.summary ?? '').slice(0, 200),
    status: String(f.status?.name ?? ''),
    done: f.status?.statusCategory?.key === 'done',
    epicKey: String(f.parent?.key ?? ''), // a sub-task's parent is its story: the caller swaps in the story's epic
    assigneeId: a?.accountId ?? null,
    assigneeName: a?.name ?? null,
    originalDays: days(f.timeoriginalestimate),
    remainingDays: days(f.timeestimate),
    origSec: secs(f.timeoriginalestimate), remSec: secs(f.timeestimate),
    sprint: sprintField ? pickSprint(f[sprintField]) : null,
    sprints: sprintField ? allSprints(f[sprintField]) : [],
    resolvedDate: date(f.resolutiondate),
    resolution: f.resolution?.name ? String(f.resolution.name) : null,
    subtask: !!f.issuetype?.subtask,
    type: f.issuetype?.name ? String(f.issuetype.name) : undefined,
    rank,
    assignee: a,
  };
}

/** quarter labels ("Q4-2026", "q4_2026", "Q4 2026") → "Q4-2026", in date order; other labels ignored */
export function quarterLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  const qs = labels.flatMap((l) => { const m = /^q([1-4])[\s_-]?(20\d\d)$/i.exec(String(l).trim()); return m ? [`Q${m[1]}-${m[2]}`] : []; });
  return [...new Set(qs)].sort(byQuarter);
}
export const byQuarter = (a: string, b: string) => a.slice(3).localeCompare(b.slice(3)) || a.localeCompare(b);

export function mapEpic(raw: any): ProjectEpic | null {
  const f = raw?.fields;
  if (typeof raw?.key !== 'string' || !f) return null;
  return { key: raw.key, summary: String(f.summary ?? '').slice(0, 200), status: String(f.status?.name ?? ''), done: f.status?.statusCategory?.key === 'done', dueDate: date(f.duedate), estimateDays: days(f.timeoriginalestimate), quarters: quarterLabels(f.labels) };
}

/** "acme", "acme.atlassian.net" or a pasted url → "acme.atlassian.net" */
export function cleanSite(input: string): string {
  let s = String(input || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  if (/^[a-z0-9][a-z0-9-]{0,62}$/.test(s)) s += '.atlassian.net';
  if (!/^[a-z0-9][a-z0-9.-]{1,200}\.[a-z]{2,}$/.test(s)) throw new Error('Jira site should look like "acme.atlassian.net".');
  return s;
}
