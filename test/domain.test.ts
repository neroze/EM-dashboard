// Unit tests for mappers, status, org tree, capacity, export. Pure modules
// only — run with: npm test  (node --experimental-strip-types --test)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { expandDays, mapEmployees, mapHolidays, mapRequest, mapTypes, requestDates } from '../backend/bamboo/mappers.ts';
import { cleanDomain } from '../backend/bamboo/client.ts';
import { capacityByTeam, teamLoad, workingDays } from '../backend/domain/capacity.ts';
import { addMonths, eachDay, isWeekend } from '../backend/domain/dates.ts';
import { toCsv, toXlsx } from '../backend/domain/export.ts';
import { sortRecords } from '../backend/domain/sort.ts';
import { appStatus, bambooStatusesFor } from '../backend/domain/status.ts';
import type { LeaveRecord } from '../backend/domain/types.ts';
import { markScope, subtree } from '../backend/sync/orgTree.ts';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const noHol = () => false;

test('status maps 1:1 from BambooHR', () => {
  assert.equal(appStatus('approved'), 'planned');
  assert.equal(appStatus('requested'), 'draft');
  assert.equal(appStatus('denied'), 'denied');
  assert.equal(appStatus('canceled'), 'canceled');
  assert.equal(appStatus('superceded'), 'canceled');
  assert.deepEqual(bambooStatusesFor(undefined), ['approved', 'requested']);
  assert.deepEqual(bambooStatusesFor(['draft']), ['requested']);
  assert.deepEqual(bambooStatusesFor(['canceled']), ['canceled', 'superceded']);
});

test('employees: names, manager ids, fallbacks', () => {
  const e = mapEmployees(fx('employees.json'));
  assert.equal(e.length, 13);
  assert.equal(e.find((x) => x.id === '103')!.displayName, 'Person C');
  assert.equal(e.find((x) => x.id === '104')!.reportsToId, '103'); // supervisorId fallback
  assert.equal(e.find((x) => x.id === '104')!.location, null);
  assert.ok(e.every((x) => x.team === null && !x.inScope));
});

test('org tree: direct + indirect reports only, cycle-safe', () => {
  const e = mapEmployees(fx('employees.json'));
  assert.deepEqual([...subtree(e, '100')].sort(), ['101', '102', '103', '104', '105', '106', '107', '108', '109']);
  assert.deepEqual([...subtree(e, '101')].sort(), ['103', '104']);
  assert.deepEqual([...subtree(e, '201')].sort(), ['202']); // loop terminates
  const scoped = markScope(e, '100');
  assert.equal(scoped.find((x) => x.id === '200')!.inScope, false);
  assert.equal(scoped.find((x) => x.id === '100')!.inScope, false);
});

test('only active employees are in scope', () => {
  const e = mapEmployees(fx('employees.json'), '2026-11-12');
  const scoped = markScope(e, '100');
  const inScope = scoped.filter((x) => x.inScope).map((x) => x.id).sort();
  // 105 inactive, 107 termination date passed, 108 inactive lead — all hidden;
  // 106 is serving notice (future date) and 109 still reports to the departed
  // lead, so both stay visible
  assert.deepEqual(inScope, ['101', '102', '103', '104', '106', '109']);
  assert.equal(e.find((x) => x.id === '101')!.active, true); // no status field = active (directory endpoint)
});

test('leave types keep their BambooHR names', () => {
  assert.deepEqual(mapTypes(fx('types.json')), [{ id: '78', name: 'Vacation' }, { id: '79', name: 'Sick' }]);
});

test('requests: valid ones mapped, notes dropped, junk skipped', () => {
  const raw = fx('requests.json');
  const rows = raw.map((r: any) => mapRequest(r, 'now')).filter(Boolean);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r: any) => r.bambooStatus), ['approved', 'requested', 'denied', 'superceded']);
  assert.equal(rows[0].requestedAt, '2026-11-01');
  assert.ok(!('notes' in rows[0]));
  assert.equal(rows[1].amount, 0.5);
});

test('leave days: per-day hours, weekends skipped, half days, holidays', () => {
  const raw = fx('requests.json');
  const a = mapRequest(raw[0], 'now')!;
  const daysA = expandDays(a, requestDates(raw[0]), noHol, 8);
  assert.deepEqual(daysA.map((d) => [d.day, d.fraction]), [['2026-11-13', 1], ['2026-11-16', 1], ['2026-11-17', 1]]);

  const b = mapRequest(raw[1], 'now')!;
  assert.deepEqual(expandDays(b, null, noHol).map((d) => d.fraction), [0.5]);

  const d = mapRequest(raw[3], 'now')!; // 24 Dec (Thu) – 28 Dec (Mon), 25th a holiday
  const hol = (day: string) => day === '2026-12-25';
  assert.deepEqual(expandDays(d, null, hol).map((x) => x.day), ['2026-12-24', '2026-12-28']);

  const fourHours = { ...a, amountUnit: 'hours' };
  assert.equal(expandDays(fourHours, { '2026-11-13': 4 }, noHol, 8)[0].fraction, 0.5);
});

test('holidays: only holiday entries, ranges expanded', () => {
  const h = mapHolidays(fx('whos_out.json'));
  assert.deepEqual(h.map((x) => x.day), ['2026-12-25', '2026-12-26', '2027-01-01']);
  assert.ok(h.every((x) => x.location === '*'));
});

test('dates', () => {
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(addMonths('2026-11-12', -3), '2026-08-12');
  assert.equal(eachDay('2026-12-30', '2027-01-02').length, 4);
  assert.ok(isWeekend('2026-11-14') && !isWeekend('2026-11-13'));
});

const people = [
  { id: 'a', displayName: 'A', team: 'SOC Workflow', location: 'London' },
  { id: 'b', displayName: 'B', team: 'SOC Workflow', location: 'Kathmandu' },
  { id: 'c', displayName: 'C', team: 'SOC Workflow', location: 'London' },
  { id: 'd', displayName: 'D', team: 'Data Platform', location: 'London' },
];

test('capacity: working days − location holidays, planned vs draft separate', () => {
  // Q4 2026 Sprint 4: 13–26 Nov = 10 working days
  const hol = (day: string, loc: string) => loc === 'Kathmandu' && day === '2026-11-16';
  assert.equal(workingDays('2026-11-13', '2026-11-26', 'London', hol), 10);
  assert.equal(workingDays('2026-11-13', '2026-11-26', 'Kathmandu', hol), 9);
  const days = [
    { employeeId: 'a', day: '2026-11-13', fraction: 1, status: 'planned' as const },
    { employeeId: 'a', day: '2026-11-17', fraction: 0.5, status: 'draft' as const },
    { employeeId: 'b', day: '2026-11-18', fraction: 1, status: 'draft' as const },
    { employeeId: 'b', day: '2026-12-01', fraction: 1, status: 'planned' as const }, // outside the sprint
    { employeeId: 'd', day: '2026-11-20', fraction: 1, status: 'denied' as const }, // never counted
  ];
  const t = capacityByTeam(people, days, '2026-11-13', '2026-11-26', hol);
  const soc = t.find((x) => x.team === 'SOC Workflow')!;
  assert.equal(soc.available, 29);
  assert.equal(soc.plannedOut, 1);
  assert.equal(soc.draftOut, 1.5);
  assert.equal(soc.net, 26.5);
  assert.equal(soc.netPlanned, 28);
  const dp = t.find((x) => x.team === 'Data Platform')!;
  assert.equal(dp.plannedOut + dp.draftOut, 0);
});

test('overlap: share ≥ threshold flags the team-day', () => {
  const days = [
    { employeeId: 'a', day: '2026-11-19', fraction: 1, status: 'planned' as const },
    { employeeId: 'b', day: '2026-11-19', fraction: 0.5, status: 'draft' as const },
    { employeeId: 'a', day: '2026-11-20', fraction: 1, status: 'planned' as const },
    { employeeId: 'a', day: '2026-11-20', fraction: 1, status: 'draft' as const }, // same person twice = 1
  ];
  const load = teamLoad(people, days, '2026-11-19', '2026-11-20', () => 0.3);
  const d19 = load.find((d) => d.day === '2026-11-19')!.teams[0];
  assert.equal(d19.out, 1.5);
  assert.equal(d19.share, 0.5);
  assert.ok(d19.flagged);
  const d20 = load.find((d) => d.day === '2026-11-20')!.teams[0];
  assert.equal(d20.out, 1);
  assert.equal(d20.planned, 1);
  assert.equal(d20.draft, 0);
  assert.ok(d20.flagged); // 1/3 ≥ 0.3
  assert.ok(!teamLoad(people, days, '2026-11-20', '2026-11-20', () => 0.5)[0].flagged);
  // ≥ N people mode
  assert.ok(teamLoad(people, days, '2026-11-19', '2026-11-19', () => 1, 2)[0].flagged);
  assert.ok(!teamLoad(people, days, '2026-11-20', '2026-11-20', () => 0, 2)[0].flagged);
});

const rec = (o: Partial<LeaveRecord>): LeaveRecord => ({
  id: '1', employeeId: 'a', person: 'A', team: 'T', location: 'L', status: 'planned', bambooStatus: 'approved',
  typeId: '1', typeName: 'Vacation', startDate: '2026-11-13', endDate: '2026-11-13', days: 1, amount: 8,
  amountUnit: 'hours', requestedAt: '2026-11-01', requestAgeDays: 11, url: '', ...o,
});

test('export: CSV escapes and neutralises formulas; xlsx is a zip', () => {
  const csv = toCsv([rec({ person: 'Doe, "J"' }), rec({ id: '2', typeName: '=HYPERLINK("x")' })]);
  const lines = csv.replace('﻿', '').trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[1].startsWith('"Doe, ""J"""'));
  assert.ok(lines[2].includes(`"'=HYPERLINK(""x"")"`));
  const x = toXlsx([rec({})]);
  assert.deepEqual([...x.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
});

test('sort: stable and matches the on-screen order', () => {
  const rows = [rec({ id: '1', status: 'planned', person: 'B' }), rec({ id: '2', status: 'draft', person: 'A' })];
  assert.deepEqual(sortRecords(rows, { key: 'status', dir: 'asc' }).map((r) => r.id), ['2', '1']);
  assert.deepEqual(sortRecords(rows, { key: 'person', dir: 'desc' }).map((r) => r.id), ['1', '2']);
});

test('company domain input is normalised', () => {
  assert.equal(cleanDomain('https://Acme.bamboohr.com/home'), 'acme');
  assert.equal(cleanDomain('acme'), 'acme');
  assert.throws(() => cleanDomain('ac me'));
  assert.throws(() => cleanDomain(''));
});

test('resource sampling: ps + launchctl parsing', async () => {
  const { parseEtime, parsePs, parseLaunchctl } = await import('../backend/domain/resources.ts');
  assert.equal(parseEtime('00:27'), 27);
  assert.equal(parseEtime('01:02:03'), 3723);
  assert.equal(parseEtime('2-00:00:10'), 172810);
  const rows = parsePs('17852 17747   4992   0.3     00:27 /Users/x/.tinyjs/bin/tjs\n17853 17852  69056   1.5     00:27 /var/folders/T/Leave Radar\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1].comm, '/var/folders/T/Leave Radar');
  assert.equal(rows[1].ppid, 17852);
  const lc = '\tservices = {\n\t\t       0      - \tcom.apple.WebKit.WebContent\n\t\t   17864      - \tcom.apple.WebKit.Networking.600CC609\n\t\t   17861      - \tcom.apple.WebKit.WebContent.55E0D229\n\t\tcom.apple.SafariServices\n';
  assert.deepEqual([...parseLaunchctl(lc)].sort(), [17861, 17864]);
});

test('dashboard: windows, WFH split, same-day clashes, ranking', async () => {
  const { buildDashboard, dashRanges, isWfhType } = await import('../backend/domain/dashboard.ts');
  // Thursday 2026-11-12 -> next week Mon 16 .. Sun 22, month Nov 1..30
  assert.deepEqual(dashRanges('2026-11-12'), { nextWeek: { from: '2026-11-16', to: '2026-11-22' }, month: { from: '2026-11-01', to: '2026-11-30' } });
  assert.deepEqual(dashRanges('2026-11-15').nextWeek.from, '2026-11-16'); // Sunday -> tomorrow
  assert.deepEqual(dashRanges('2026-11-16').nextWeek.from, '2026-11-23'); // Monday -> a week on
  assert.ok(isWfhType('Work From Home') && isWfhType('WFH') && isWfhType('Remote work') && !isWfhType('Vacation'));

  const rec = (id: string, emp: string, status: any, typeName: string, s: string, e = s) =>
    ({ id, employeeId: emp, person: 'P' + emp, team: 'T', status, typeName, startDate: s, endDate: e });
  const recs = [
    rec('a', '1', 'planned', 'Vacation', '2026-11-12', '2026-11-13'),
    rec('b', '2', 'draft', 'Vacation', '2026-11-12'),
    rec('c', '3', 'denied', 'Vacation', '2026-11-12'),
    rec('d', '1', 'planned', 'Vacation', '2026-11-17'),
    rec('w', '2', 'planned', 'Work From Home', '2026-11-12'),
  ];
  const day = (requestId: string, employeeId: string, d: string, fraction = 1) => ({ requestId, employeeId, day: d, fraction });
  const days = [day('a', '1', '2026-11-12'), day('a', '1', '2026-11-13'), day('b', '2', '2026-11-12', 0.5),
    day('c', '3', '2026-11-12'), day('d', '1', '2026-11-17'), day('w', '2', '2026-11-12')];
  const d = buildDashboard('2026-11-12', recs, days);

  assert.deepEqual(d.leave.today.counts, { planned: 1, draft: 1, denied: 1, canceled: 0 });
  assert.equal(d.leave.today.people, 2); // denied doesn't count as away
  assert.deepEqual(d.leave.nextWeek.items.map((i) => i.id), ['d']);
  assert.deepEqual(d.leave.month.items.map((i) => i.id).sort(), ['a', 'b', 'd']);
  assert.deepEqual(d.leave.sameDay.map((x) => [x.day, x.people.length]), [['2026-11-12', 2]]);
  assert.deepEqual(d.leave.ranking.map((r) => [r.employeeId, r.days, r.requests]), [['1', 3, 2], ['2', 0.5, 1]]);
  assert.deepEqual(d.wfh.today.items.map((i) => i.id), ['w']);
  assert.equal(d.wfh.sameDay.length, 0);
  assert.deepEqual(d.wfhTypes, ['Work From Home']);
  assert.deepEqual(d.types, ['Vacation', 'Work From Home']);
  assert.deepEqual(d.leave.ranking[0].byType, { Vacation: 3 });
  assert.equal(d.leave.daily.length, 21); // Nov 2026 working days
  assert.deepEqual(d.leave.daily.find((x) => x.day === '2026-11-12'), { day: '2026-11-12', people: 2, byType: { Vacation: 1.5 } });
});

test('dashboard: sprints around today, leave per sprint', async () => {
  const { buildDashboard, pickSprints } = await import('../backend/domain/dashboard.ts');
  const sp = [
    { name: 'S1', startDate: '2026-10-19', endDate: '2026-11-01' },
    { name: 'S2', startDate: '2026-11-02', endDate: '2026-11-15' },
    { name: 'S3', startDate: '2026-11-16', endDate: '2026-11-29' },
    { name: 'S4', startDate: '2026-11-30', endDate: '2026-12-13' },
    { name: 'S5', startDate: '2026-12-14', endDate: '2026-12-27' },
  ];
  assert.deepEqual(pickSprints('2026-11-12', sp).map((s) => [s.name, s.role]),
    [['S1', 'previous'], ['S2', 'current'], ['S3', 'next'], ['S4', 'upcoming']]);
  // between sprints: no current, the first future one is next
  assert.deepEqual(pickSprints('2026-11-01', sp.filter((s) => s.name !== 'S1')).map((s) => [s.name, s.role]),
    [['S2', 'next'], ['S3', 'upcoming']]);

  const rec = (id: string, emp: string, status: any, typeName: string) =>
    ({ id, employeeId: emp, person: 'P' + emp, team: 'T', status, typeName, startDate: '2026-11-12', endDate: '2026-11-17' });
  const recs = [rec('a', '1', 'planned', 'Vacation'), rec('b', '2', 'draft', 'Sick'), rec('w', '3', 'planned', 'WFH'), rec('x', '4', 'denied', 'Vacation')];
  const day = (requestId: string, employeeId: string, d: string) => ({ requestId, employeeId, day: d, fraction: 1 });
  const days = [day('a', '1', '2026-11-12'), day('a', '1', '2026-11-13'), day('a', '1', '2026-11-16'),
    day('b', '2', '2026-11-13'), day('w', '3', '2026-11-12'), day('x', '4', '2026-11-12')];
  const d = buildDashboard('2026-11-12', recs, days, sp);
  const s2 = d.sprints.find((s) => s.name === 'S2')!;
  assert.equal(s2.role, 'current');
  assert.deepEqual([s2.days, s2.planned, s2.draft], [3, 2, 1]); // WFH and denied left out
  assert.deepEqual(s2.people.map((p) => [p.employeeId, p.days, p.first, p.last]), [['1', 2, '2026-11-12', '2026-11-13'], ['2', 1, '2026-11-13', '2026-11-13']]);
  assert.deepEqual(d.sprints.find((s) => s.name === 'S3')!.byType, { Vacation: 1 });
});

test('year summary: months, quarters, leave vs WFH', async () => {
  const { yearSummary } = await import('../backend/domain/dashboard.ts');
  const rec = (id: string, emp: string, status: any, typeName: string) =>
    ({ id, employeeId: emp, person: 'P' + emp, team: 'T', status, typeName, startDate: '', endDate: '' });
  const recs = [rec('a', '1', 'planned', 'Vacation'), rec('w', '2', 'draft', 'Work From Home'), rec('x', '3', 'denied', 'Vacation')];
  const day = (requestId: string, employeeId: string, d: string, fraction = 1) => ({ requestId, employeeId, day: d, fraction });
  const days = [day('a', '1', '2026-03-31'), day('a', '1', '2026-04-01'), day('w', '2', '2026-04-02', 0.5),
    day('x', '3', '2026-04-03'), day('a', '1', '2025-12-31')];
  const y = yearSummary(2026, '2026-11-12', recs, days);
  assert.equal(y.months.length, 12);
  assert.deepEqual([y.months[2].leave.days, y.months[3].leave.days, y.months[3].wfh.days], [1, 1, 0.5]);
  assert.deepEqual(y.quarters.map((q) => [q.q, q.leave.days, q.leave.requests, q.wfh.days]), [[1, 1, 1, 0], [2, 1, 1, 0.5], [3, 0, 0, 0], [4, 0, 0, 0]]);
  assert.deepEqual([y.quarters[1].from, y.quarters[1].to], ['2026-04-01', '2026-06-30']);
  assert.deepEqual(y.quarters[1].leave.byPerson, { 1: { person: 'P1', team: 'T', days: 1, requests: 1 } });
  assert.deepEqual(y.quarters[1].wfh.byPerson, { 2: { person: 'P2', team: 'T', days: 0.5, requests: 1 } });
});

test('long / mini leave: runs across weekends, holidays and back-to-back requests', async () => {
  const { findRuns, longLeaveYear } = await import('../backend/domain/longleave.ts');
  const { eachDay, isWeekend } = await import('../backend/domain/dates.ts');
  const rec = (id: string, emp: string, status: any, typeName = 'Vacation') =>
    ({ id, employeeId: emp, person: 'P' + emp, team: 'T', status, typeName, startDate: '', endDate: '' });
  const work = (a: string, b: string) => eachDay(a, b).filter((d) => !isWeekend(d));
  const days = [
    // person 1: Mon 2 Nov – Fri 6 Nov (a) + Mon 9 – Fri 13 Nov (b, draft) = 10 → long, mixed
    ...work('2026-11-02', '2026-11-06').map((d) => ({ requestId: 'a', employeeId: '1', day: d, fraction: 1 })),
    ...work('2026-11-09', '2026-11-13').map((d) => ({ requestId: 'b', employeeId: '1', day: d, fraction: 1 })),
    // person 2: Thu 24 Dec – Thu 31 Dec, holiday Fri 25 Dec skipped → 5 days → mini, crosses nothing
    ...work('2026-12-24', '2026-12-31').filter((d) => d !== '2026-12-25').map((d) => ({ requestId: 'c', employeeId: '2', day: d, fraction: 1 })),
    // person 3: 4 days only → nothing; WFH week → nothing
    ...work('2026-11-16', '2026-11-19').map((d) => ({ requestId: 'e', employeeId: '3', day: d, fraction: 1 })),
    ...work('2026-11-16', '2026-11-27').map((d) => ({ requestId: 'w', employeeId: '4', day: d, fraction: 1 })),
    // person 5: a gap day breaks the run (5 + 5 → two minis)
    ...work('2026-10-05', '2026-10-09').map((d) => ({ requestId: 'f', employeeId: '5', day: d, fraction: 1 })),
    ...work('2026-10-13', '2026-10-19').map((d) => ({ requestId: 'g', employeeId: '5', day: d, fraction: 1 })),
  ];
  const recs = [rec('a', '1', 'planned'), rec('b', '1', 'draft'), rec('c', '2', 'planned'), rec('e', '3', 'planned'),
    rec('w', '4', 'planned', 'Work From Home'), rec('f', '5', 'planned'), rec('g', '5', 'draft')];
  const runs = findRuns(recs, days, (d) => d === '2026-12-25');
  assert.deepEqual(runs.map((r) => [r.employeeId, r.kind, r.start, r.end, r.days, r.status]), [
    ['5', 'mini', '2026-10-05', '2026-10-09', 5, 'planned'],
    ['5', 'mini', '2026-10-13', '2026-10-19', 5, 'draft'],
    ['1', 'long', '2026-11-02', '2026-11-13', 10, 'mixed'],
    ['2', 'mini', '2026-12-24', '2026-12-31', 5, 'planned'],
  ]);
  const y = longLeaveYear(2026, '2026-11-12', runs);
  assert.equal(y.long.length, 1);
  assert.equal(y.mini.length, 3);
  assert.deepEqual(y.months[10].long.map((r) => r.employeeId), ['1']);
  assert.equal(y.months[9].mini.length, 2);
});
