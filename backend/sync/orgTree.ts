// Reporting hierarchy from the "reports to" field. Pure.
import type { Employee } from '../domain/types.ts';

export function childrenMap(employees: Employee[]): Map<string, string[]> {
  const kids = new Map<string, string[]>();
  for (const e of employees) {
    if (!e.reportsToId || e.reportsToId === e.id) continue;
    const list = kids.get(e.reportsToId);
    if (list) list.push(e.id); else kids.set(e.reportsToId, [e.id]);
  }
  return kids;
}

/** ids of everyone below rootId (direct + indirect), never rootId itself.
 *  Cycle-safe: a bad manager loop in the data can't hang the sync. */
export function subtree(employees: Employee[], rootId: string): Set<string> {
  const kids = childrenMap(employees);
  const seen = new Set<string>();
  const stack = [...(kids.get(rootId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === rootId || seen.has(id)) continue;
    seen.add(id);
    for (const k of kids.get(id) ?? []) stack.push(k);
  }
  return seen;
}

/** marks inScope on a copy of the list: in my reporting line AND still
 *  employed. People who left still link the tree (their reports, if not yet
 *  moved to a new manager, stay in scope) but are never shown themselves. */
export function markScope(employees: Employee[], rootId: string): Employee[] {
  const s = subtree(employees, rootId);
  return employees.map((e) => ({ ...e, inScope: s.has(e.id) && e.active !== false }));
}
