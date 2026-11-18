// Jira issue JSON → the release board's records. Pure.
import { catOf, type FixVersion, type OutsideTicket, type ReleaseEpic, type ReleaseTask } from '../domain/release.ts';

export const RELEASE_EPIC_FIELDS = ['summary', 'status', 'created', 'duedate'];
export const RELEASE_TASK_FIELDS = ['summary', 'status', 'assignee', 'issuetype', 'created', 'duedate', 'resolutiondate',
  'timeoriginalestimate', 'timeestimate', 'timespent', 'fixVersions'];
export const OUTSIDE_FIELDS = ['summary', 'status', 'assignee', 'issuetype'];

const date = (s: unknown): string | null => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const iso = (s: unknown): string | null => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s : null);
const secs = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const str = (v: unknown, max = 200) => String(v ?? '').slice(0, max);

export function mapFixVersion(v: any): FixVersion | null {
  if (!v || (typeof v.id !== 'string' && typeof v.id !== 'number') || typeof v.name !== 'string') return null;
  return { id: String(v.id), name: v.name, releaseDate: date(v.releaseDate), released: !!v.released };
}

export function mapReleaseEpic(raw: any): ReleaseEpic | null {
  const f = raw?.fields;
  if (typeof raw?.key !== 'string' || !f) return null;
  return { key: raw.key, summary: str(f.summary), status: str(f.status?.name, 60), cat: catOf(f.status?.statusCategory?.key), created: iso(f.created), dueDate: date(f.duedate) };
}

export function mapReleaseTask(raw: any): ReleaseTask | null {
  const f = raw?.fields;
  if (typeof raw?.key !== 'string' || !f) return null;
  return {
    key: raw.key, summary: str(f.summary), status: str(f.status?.name, 60), cat: catOf(f.status?.statusCategory?.key),
    type: str(f.issuetype?.name, 60),
    assigneeId: f.assignee?.accountId ? String(f.assignee.accountId) : null,
    assigneeName: f.assignee?.displayName ? String(f.assignee.displayName) : null,
    created: iso(f.created), dueDate: date(f.duedate), resolved: date(f.resolutiondate),
    origSec: secs(f.timeoriginalestimate), remSec: secs(f.timeestimate), spentSec: secs(f.timespent),
    fixVersions: (Array.isArray(f.fixVersions) ? f.fixVersions : []).map(mapFixVersion).filter((v: FixVersion | null): v is FixVersion => !!v),
  };
}

export function mapOutside(raw: any): OutsideTicket | null {
  const f = raw?.fields;
  if (typeof raw?.key !== 'string' || !f) return null;
  return { key: raw.key, summary: str(f.summary), status: str(f.status?.name, 60), cat: catOf(f.status?.statusCategory?.key), type: str(f.issuetype?.name, 60), assigneeName: f.assignee?.displayName ? String(f.assignee.displayName) : null };
}
