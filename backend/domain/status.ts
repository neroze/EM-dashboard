// App status is derived 1:1 from BambooHR's status — the app has no states
// of its own.
import type { AppStatus } from './types.ts';

export const DEFAULT_STATUSES: AppStatus[] = ['planned', 'draft'];
export const ALL_STATUSES: AppStatus[] = ['planned', 'draft', 'denied', 'canceled'];

export function appStatus(bamboo: string): AppStatus {
  switch ((bamboo || '').toLowerCase()) {
    case 'approved': return 'planned';
    case 'requested': return 'draft';
    case 'denied': return 'denied';
    default: return 'canceled'; // canceled, superceded, anything unknown
  }
}

/** BambooHR statuses that map onto the given app statuses */
export function bambooStatusesFor(statuses: AppStatus[] | undefined): string[] {
  const s = statuses && statuses.length ? statuses : DEFAULT_STATUSES;
  const out: string[] = [];
  if (s.includes('planned')) out.push('approved');
  if (s.includes('draft')) out.push('requested');
  if (s.includes('denied')) out.push('denied');
  if (s.includes('canceled')) out.push('canceled', 'superceded');
  return out;
}

/** statuses that make a person "out" (or at risk of being out) */
export function isActive(s: AppStatus): boolean {
  return s === 'planned' || s === 'draft';
}
