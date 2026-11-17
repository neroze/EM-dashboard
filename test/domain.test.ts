// Unit tests for mappers, status, org tree, capacity, export. Pure modules
// only — run with: npm test  (node --experimental-strip-types --test)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { expandDays, mapEmployees, mapHolidays, mapRequest, mapTypes, requestDates } from '../backend/bamboo/mappers.ts';
import { cleanDomain } from '../backend/bamboo/client.ts';
import { capacityByTeam, teamLoad, workingDays } from '../backend/domain/capacity.ts';
import { addMonths, eachDay, isWeekend } from '../backend/domain/dates.ts';
import { band, baselineOf, closedOutByEpic, closeWithEpics, evaluateProject, quarterTotals, schedulable, mapSprint, matchPerson, sprintBreakdown, sprintParts, withCalendarDates, windowDays, workTotals, type DayFn, type ProjectEpic, type Ticket } from '../backend/domain/projectHealth.ts';
import { allocation } from '../backend/domain/allocation.ts';
import { buildReport } from '../backend/domain/forecastReport.ts';
import { mergeBurn } from '../src/burn.ts';
import { cleanSite, mapEpic, mapTicket, quarterLabels } from '../backend/jira/mappers.ts';
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
    { employeeId: 'a', day: '2026-11-19', fraction: 1, status: 'planned' as const, wfh: true }, // working: stays available
  ];
  const t = capacityByTeam(people, days, '2026-11-13', '2026-11-26', hol);
  const soc = t.find((x) => x.team === 'SOC Workflow')!;
  assert.equal(soc.available, 29);
  assert.equal(soc.plannedOut, 1);
  assert.equal(soc.draftOut, 1.5);
  assert.equal(soc.net, 26.5);
  assert.equal(soc.netPlanned, 28);
  assert.equal(soc.wfh, 1);
  assert.equal(soc.people.find((p) => p.id === 'a')!.net, 8.5); // 10 − 1 − 0.5, the WFH day not subtracted
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

test('long leave never counts work from home, even right next to leave', async () => {
  const { findRuns } = await import('../backend/domain/longleave.ts');
  const { eachDay, isWeekend } = await import('../backend/domain/dates.ts');
  const work = (a: string, b: string) => eachDay(a, b).filter((d) => !isWeekend(d));
  const rec = (id: string, typeName: string) => ({ id, employeeId: '1', person: 'P', team: 'T', status: 'planned' as any, typeName, startDate: '', endDate: '' });
  // a leave week, then a WFH week (both spellings): 5 leave days → mini, never long
  const days = [
    ...work('2026-11-02', '2026-11-06').map((d) => ({ requestId: 'l', employeeId: '1', day: d, fraction: 1 })),
    ...work('2026-11-09', '2026-11-11').map((d) => ({ requestId: 'w1', employeeId: '1', day: d, fraction: 1 })),
    ...work('2026-11-12', '2026-11-13').map((d) => ({ requestId: 'w2', employeeId: '1', day: d, fraction: 1 })),
  ];
  const runs = findRuns([rec('l', 'Annual Leave'), rec('w1', 'Work From Home'), rec('w2', 'WFH')], days, () => false);
  assert.deepEqual(runs.map((r) => [r.kind, r.start, r.end, r.days, r.types]), [['mini', '2026-11-02', '2026-11-06', 5, ['Annual Leave']]]);
});

test('long leave counts scheduled leave only: sick and substitute leave break a run', async () => {
  const { findRuns, countsAsLongLeave } = await import('../backend/domain/longleave.ts');
  const { eachDay, isWeekend } = await import('../backend/domain/dates.ts');
  const work = (a: string, b: string) => eachDay(a, b).filter((d) => !isWeekend(d));
  const rec = (id: string, typeName: string) => ({ id, employeeId: '1', person: 'P', team: 'T', status: 'planned' as any, typeName, startDate: '', endDate: '' });
  for (const t of ['Sick Leave', 'Substitute Leave', 'Work From Home', 'WFH']) assert.equal(countsAsLongLeave(t), false, t);
  for (const t of ['Annual Leave', 'Vacation', 'Paternity Leave']) assert.equal(countsAsLongLeave(t), true, t);
  // annual Mon–Fri, sick Mon–Wed, annual Thu–Fri: 5 + 2 → one mini only, no long
  const days = [
    ...work('2026-11-02', '2026-11-06').map((d) => ({ requestId: 'a', employeeId: '1', day: d, fraction: 1 })),
    ...work('2026-11-09', '2026-11-11').map((d) => ({ requestId: 's', employeeId: '1', day: d, fraction: 1 })),
    ...work('2026-11-12', '2026-11-13').map((d) => ({ requestId: 'b', employeeId: '1', day: d, fraction: 1 })),
    // two weeks of substitute leave → nothing
    ...work('2026-12-07', '2026-12-18').map((d) => ({ requestId: 'u', employeeId: '1', day: d, fraction: 1 })),
  ];
  const runs = findRuns([rec('a', 'Annual Leave'), rec('s', 'Sick Leave'), rec('b', 'Annual Leave'), rec('u', 'Substitute Leave')], days, () => false);
  assert.deepEqual(runs.map((r) => [r.kind, r.start, r.end, r.days]), [['mini', '2026-11-02', '2026-11-06', 5]]);
});

test('demo teams get their own reporting lines', async () => {
  const { demoRootFor, DEMO_ME } = await import('../backend/bamboo/demo.ts');
  assert.equal(demoRootFor(0, 1), DEMO_ME); // one demo team: whole demo org
  assert.equal(demoRootFor(0, 2), '9001');  // two: lead A's and lead B's people
  assert.equal(demoRootFor(1, 2), '9002');
});

test('auto layout: charts wide, tall widgets wider, rows filled', async () => {
  const { autoSpans } = await import('../src/state/layout.ts');
  const w = (want: number, h: number) => ({ want, h });
  // 4 columns: today/week/month/same-day/person (person is very tall), chart wants 2
  assert.deepEqual(autoSpans([w(1, 200), w(1, 220), w(1, 210), w(1, 230), w(1, 600)], 4), [1, 1, 1, 1, 4]);
  // 3 columns: the tall one widens to 2, rows end flush
  assert.deepEqual(autoSpans([w(1, 200), w(1, 600), w(1, 210), w(1, 220)], 3), [1, 2, 1, 2]); // spare column → the row's tallest
  // a chart (wants 2) never exceeds the columns that fit
  assert.deepEqual(autoSpans([w(2, 300), w(1, 200)], 1), [1, 1]);
  // every row sums to the column count
  const s = autoSpans([w(1, 100), w(2, 300), w(1, 150), w(1, 160), w(1, 170)], 3);
  let row = 0; for (const x of s) { row += x; if (row > 3) assert.fail('row overflow'); if (row === 3) row = 0; }
  assert.equal(row, 0);
});

test('auto layout keeps widths the user set and packs around them', async () => {
  const { autoPlan } = await import('../src/state/layout.ts');
  const it = (key: string, want: number, h: number, fixed = false) => ({ key, want, h, fixed });
  // 4 columns; user made "today" 3 wide. Week (1) fits beside it; month+same day+person follow.
  let p = autoPlan([it('today', 3, 200, true), it('week', 1, 200), it('month', 1, 210), it('same', 1, 220), it('person', 1, 250)], 4);
  assert.equal(p.spans.today, 3);                       // untouched
  assert.deepEqual(p.order, ['today', 'week', 'month', 'same', 'person']);
  assert.equal(p.spans.month + p.spans.same + p.spans.person, 4); // second row flush, spare to the tallest free one
  assert.equal(p.spans.person, 2);
  // user made "week" 2 wide in 3 columns: today(1)+week(2) fill row 1; nothing of theirs changes
  p = autoPlan([it('today', 1, 200), it('week', 2, 200, true), it('month', 1, 300), it('same', 1, 200)], 3);
  assert.equal(p.spans.week, 2);
  assert.deepEqual(p.order.slice(0, 2), ['today', 'week']);
  // a row the user filled with fixed widths that don't fit: a later narrow item is pulled forward
  p = autoPlan([it('a', 2, 200, true), it('b', 2, 200, true), it('c', 1, 200), it('d', 1, 200)], 3);
  assert.deepEqual(p.order.slice(0, 2), ['a', 'c']);     // c fills the gap after a; b starts the next row
  assert.equal(p.spans.a, 2); assert.equal(p.spans.b, 2);
  // a user width wider than the window is capped for layout, but kept
  p = autoPlan([it('a', 4, 200, true), it('b', 1, 200)], 2);
  assert.equal(p.spans.a, 2);
});

// ---- project health --------------------------------------------------------------
// Fri 13 – Thu 26 Nov 2026 = 10 working days (Mon–Fri, no holidays)
const PR = { startDate: '2026-11-13', deadline: '2026-11-26' };
const dayOf = (leave: Record<string, number> = {}): DayFn => (id, d) =>
  isWeekend(d) ? { working: false, out: 0 } : { working: true, out: leave[id + '|' + d] ?? 0 };
let rank = 0;
const tk = (key: string, x: Partial<Ticket> = {}): Ticket => ({
  key, summary: key, status: x.done ? 'Done' : 'To Do', done: false, epicKey: 'E-1', assigneeId: null, assigneeName: null,
  originalDays: null, remainingDays: null, sprint: null, rank: rank++, ...x,
});
const E1: ProjectEpic = { key: 'E-1', summary: 'Epic one', status: 'In Progress', done: false, dueDate: null };
const same = (id: string | null) => id;

test('project: totals — done = burned estimate, remaining, scope growth', () => {
  const ts = [
    tk('T-1', { originalDays: 3, remainingDays: 0, done: true }),
    tk('T-2', { originalDays: 4, remainingDays: 1.5 }), // 2.5 burned
    tk('T-3', { originalDays: 2, remainingDays: 3 }),   // grew: 0 burned, 3 left
    tk('T-4'),                                           // unestimated
  ];
  assert.deepEqual(workTotals(ts), { original: 9, current: 10, done: 5.5, remaining: 4.5, tickets: 4, open: 3, unestimated: 1 });
});

test('project: capacity = working days − booked leave, everyone at 100%', () => {
  const day = dayOf({ 'a|2026-11-16': 1, 'a|2026-11-17': 1, 'a|2026-11-18': 0.5 });
  assert.deepEqual(windowDays('a', PR.startDate, PR.deadline, day), { working: 10, unavailable: 2.5, available: 7.5 });
});

test('project: health bands — green ≤ 80%, amber ≤ 100%, red above', () => {
  assert.equal(band(0.8), 'green');
  assert.equal(band(0.80001), 'amber');
  assert.equal(band(1.0), 'amber');
  assert.equal(band(1.01), 'red');
  assert.equal(band(Infinity), 'red');
});

test('project: forecast walks each person’s tickets around their leave', () => {
  const ts = [tk('T-1', { assigneeId: 'a', originalDays: 5 }), tk('T-2', { assigneeId: 'a', originalDays: 3 })];
  let h = evaluateProject(PR, [E1], ts, same, dayOf(), '2026-11-01');
  assert.equal(h.ticketFinish['T-1'], '2026-11-19'); // 5 days from Fri 13
  assert.equal(h.finish, '2026-11-24');
  assert.equal(h.lateDays, 0);
  assert.equal(h.status, 'green'); // 8 / 10
  // 4 days of booked leave: 6 available, finishes 2 working days late
  h = evaluateProject(PR, [E1], ts, same, dayOf({ 'a|2026-11-16': 1, 'a|2026-11-17': 1, 'a|2026-11-18': 1, 'a|2026-11-19': 1 }), '2026-11-01');
  assert.equal(h.finish, '2026-11-30');
  assert.equal(h.lateDays, 2);
  assert.equal(h.status, 'red');
  assert.equal(h.epics[0].health, 'red');
  assert.equal(h.people[0].leave, 4);
});

test('project: active sprint first, then future, then backlog', () => {
  const s = (state: 'active' | 'future', startDate: string) => ({ name: state, state, startDate, endDate: '2026-12-31' });
  const ts = [tk('B', { assigneeId: 'a', originalDays: 1 }), tk('F', { assigneeId: 'a', originalDays: 1, sprint: s('future', '2026-11-27') }),
    tk('A', { assigneeId: 'a', originalDays: 1, sprint: s('active', '2026-11-13') })];
  const h = evaluateProject(PR, [E1], ts, same, dayOf(), '2026-11-01');
  assert.equal(h.ticketFinish['A'], '2026-11-13');
  assert.equal(h.ticketFinish['F'], '2026-11-16');
  assert.equal(h.ticketFinish['B'], '2026-11-17');
});

test('project: unassigned work goes to whoever frees up first; pooled finish', () => {
  const ts = [tk('T-1', { assigneeId: 'a', originalDays: 6 }), tk('T-2', { assigneeId: 'b', originalDays: 2 }), tk('T-3', { originalDays: 2 })];
  const h = evaluateProject(PR, [E1], ts, same, dayOf(), '2026-11-01');
  assert.equal(h.ticketFinish['T-3'], '2026-11-18'); // b is free after 2 days
  assert.equal(h.finish, '2026-11-20');                // a's 6 days
  assert.equal(h.pooledFinish, '2026-11-19');          // 10 days ÷ 2 people
  assert.deepEqual(h.unassigned, { remaining: 2, tickets: 1 });
});

test('project: mid-way — capacity burned, pace, remaining from today', () => {
  const ts = [tk('T-1', { assigneeId: 'a', originalDays: 4, remainingDays: 0, done: true }), tk('T-2', { assigneeId: 'a', originalDays: 6, remainingDays: 6 })];
  const h = evaluateProject(PR, [E1], ts, same, dayOf(), '2026-11-19'); // Thu: 4 days burned (13, 16, 17, 18)
  assert.equal(h.burned, 4);
  assert.equal(h.availableAhead, 6);
  assert.equal(h.capacityUsedPct, 0.4);
  assert.equal(h.workDonePct, 0.4);
  assert.deepEqual(h.pace, { rate: 1, capacityNeeded: 6 });
  assert.equal(h.finish, '2026-11-26');
  assert.equal(h.status, 'amber'); // 6 left / 6 available = 100%
});

test('project: match Jira assignees — manual, email, unique name', () => {
  const people = [{ id: '1', displayName: 'Ana Núñez', email: 'ana@x.io' }, { id: '2', displayName: 'Bo Li', email: null }, { id: '3', displayName: 'Bo Li', email: null }];
  assert.deepEqual(matchPerson({ accountId: 'j1', name: 'Someone', email: 'ANA@x.io' }, people, {}), { id: '1', how: 'email' });
  assert.deepEqual(matchPerson({ accountId: 'j1', name: 'ana nunez', email: null }, people, {}), { id: '1', how: 'name' });
  assert.deepEqual(matchPerson({ accountId: 'j2', name: 'Bo Li', email: null }, people, {}), { id: null, how: 'none' }); // ambiguous
  assert.deepEqual(matchPerson({ accountId: 'j2', name: 'Bo Li', email: null }, people, { j2: '3' }), { id: '3', how: 'manual' });
});

test('project: Jira mapper — 6-hour days, sprint pick, parent epic', () => {
  const t = mapTicket({ key: 'P-7', fields: { summary: 'x', status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    parent: { key: 'E-1' }, assignee: { accountId: 'acc', displayName: 'A' },
    timeoriginalestimate: 6 * 3600 * 2, timeestimate: 3 * 3600, resolution: null, issuetype: { subtask: false },
    customfield_10020: [{ name: 'S3', state: 'closed', endDate: '2026-11-12T10:00:00Z' }, { name: 'S4', state: 'active', startDate: '2026-11-13T09:00:00Z', endDate: '2026-11-26T17:00:00Z' }] } }, 0, 'customfield_10020')!;
  assert.equal(t.originalDays, 2);
  assert.equal(t.remainingDays, 0.5);
  assert.equal(t.epicKey, 'E-1');
  assert.deepEqual(t.sprint, { id: null, name: 'S4', state: 'active', startDate: '2026-11-13', endDate: '2026-11-26' });
  assert.equal(t.assignee?.accountId, 'acc');
  assert.equal(cleanSite('acme'), 'acme.atlassian.net');
});

// two-week calendar sprints: S4 13–26 Nov, S5 27 Nov – 10 Dec (each 10 working days)
const CAL = [
  { name: 'Q4 2026 Sprint 4', startDate: '2026-11-13', endDate: '2026-11-26' },
  { name: 'Q4 2026 Sprint 5', startDate: '2026-11-27', endDate: '2026-12-10' },
];

test('sprints: Jira sprint → calendar sprint by name, else by date', () => {
  assert.equal(mapSprint({ name: 'q4 2026 sprint 4', state: 'active', startDate: null, endDate: null }, CAL), 'Q4 2026 Sprint 4');
  assert.equal(mapSprint({ name: 'SOC Sprint 41', state: 'future', startDate: '2026-11-27', endDate: '2026-12-10' }, CAL), 'Q4 2026 Sprint 5');
  assert.equal(mapSprint({ name: 'Old', state: 'closed', startDate: '2026-01-01', endDate: '2026-01-14' }, CAL), null);
  assert.equal(mapSprint(null, CAL), null);
});

test('sprints: capacity, burned, Jira load and forecast load per sprint', () => {
  const P2 = { startDate: '2026-11-13', deadline: '2026-12-10' };
  const s4 = { name: 'Q4 2026 Sprint 4', state: 'active' as const, startDate: '2026-11-13', endDate: '2026-11-26' };
  const s5 = { name: 'Q4 2026 Sprint 5', state: 'future' as const, startDate: '2026-11-27', endDate: '2026-12-10' };
  const ts = [
    tk('T-1', { assigneeId: 'a', originalDays: 4, remainingDays: 0, done: true, sprint: s4 }),
    tk('T-2', { assigneeId: 'a', originalDays: 6, remainingDays: 6, sprint: s4 }),
    tk('T-3', { assigneeId: 'a', originalDays: 3, sprint: s5 }),
    tk('T-4', { assigneeId: 'a', originalDays: 2 }), // backlog
  ];
  const day = dayOf({ 'a|2026-11-30': 1, 'a|2026-12-01': 1 }); // 2 days leave in S5
  const today = '2026-11-19'; // Thu of S4: 13, 16, 17, 18 have passed
  const r = evaluateProject(P2, [E1], ts, same, day, today);
  const b = sprintBreakdown(P2, CAL, ts, same, r, day, today);
  const [x4, x5] = b.sprints;
  assert.equal(x4.state, 'active');
  assert.equal(x4.available, 10);
  assert.equal(x4.elapsed, 4);
  assert.equal(x4.elapsedPct, 0.4);
  assert.equal(x4.burnedPct, 0.4); // 4 estimate-days done of 10 available
  assert.equal(x4.pace, 'on-pace');
  assert.equal(x5.burnedPct, 0);
  assert.equal(x4.people[0].done, 4);
  assert.equal(x4.committed, 10);
  assert.equal(x4.done, 4);
  assert.equal(x4.remaining, 6);
  assert.equal(x4.band, 'amber');  // 6 left / 6 days left
  assert.equal(x4.forecast, 6);    // T-2 fills the rest of S4
  assert.equal(x5.leave, 2);
  assert.equal(x5.available, 8);
  assert.equal(x5.committed, 3);
  assert.equal(x5.forecast, 5);    // T-3 (3) + backlog T-4 (2)
  assert.equal(x5.people[0].utilisation, 3 / 8);
  assert.deepEqual(b.backlog, { remaining: 2, tickets: 1 });
});

test('sprints: the table starts at Sprint 1, even before the project start', () => {
  const cal = [{ name: 'Q4 2026 Sprint 1', startDate: '2026-10-02', endDate: '2026-10-15' }, ...CAL];
  const P3 = { startDate: '2026-11-13', deadline: '2026-11-26' };
  const ts = [tk('T-1', { assigneeId: 'a', originalDays: 2, remainingDays: 0, done: true, sprint: { name: 'Q4 2026 Sprint 1', state: 'closed', startDate: null, endDate: null } })];
  const r = evaluateProject(P3, [E1], ts, same, dayOf(), '2026-11-19');
  const b = sprintBreakdown(P3, cal, ts, same, r, dayOf(), '2026-11-19');
  assert.deepEqual(b.sprints.map((s) => s.name), ['Q4 2026 Sprint 1', 'Q4 2026 Sprint 4']); // ends at the deadline sprint
  assert.equal(b.sprints[0].beforeStart, true);
  assert.equal(b.sprints[0].state, 'past');
  assert.equal(b.sprints[0].available, 10); // full sprint, not clipped
  assert.equal(b.sprints[0].done, 2);
  assert.equal(b.sprints[1].beforeStart, false);
});

test('sprints: capacity counts only people with tickets in that sprint', () => {
  const P4 = { startDate: '2026-11-13', deadline: '2026-12-10' };
  const s4 = { name: 'Q4 2026 Sprint 4', state: 'active' as const, startDate: '2026-11-13', endDate: '2026-11-26' };
  const ts = [
    tk('A-1', { assigneeId: 'a', originalDays: 3, sprint: s4 }),   // a: in Sprint 4
    tk('B-1', { assigneeId: 'b', originalDays: 2 }),               // b: backlog only
  ];
  const day = dayOf({ 'b|2026-11-16': 1 });
  const r = evaluateProject(P4, [E1], ts, same, day, '2026-11-01');
  const [x4, x5] = sprintBreakdown(P4, CAL, ts, same, r, day, '2026-11-01').sprints;
  // Sprint 4: only a counts — b's leave and days are not in its capacity
  assert.equal(x4.assignedPeople, 1);
  assert.equal(x4.working, 10);
  assert.equal(x4.leave, 0);
  assert.equal(x4.available, 10);
  assert.equal(x4.committed, 3);
  // b still shows, as forecast-only (they'll do their backlog ticket in Sprint 4)
  const b = x4.people.find((q) => q.id === 'b')!;
  assert.equal(b.assigned, false);
  assert.equal(b.forecast, 2);
  assert.equal(x4.forecast, 3);
  assert.equal(x4.forecastOthers, 2);
  // Sprint 5: nobody has tickets → no capacity
  assert.equal(x5.assignedPeople, 0);
  assert.equal(x5.available, 0);
  assert.equal(x5.people.length, 0);
});

test('sprints: board naming schemes and undated future sprints still map', () => {
  assert.deepEqual(sprintParts('Q4 2026 Sprint 4'), { year: 2026, quarter: 4, num: 4 });
  assert.deepEqual(sprintParts('Data_Platform_2026_Q4_Sprint4'), { year: 2026, quarter: 4, num: 4 });
  assert.deepEqual(sprintParts('DI_Q4_26Sprint5'), { year: 2026, quarter: 4, num: 5 });
  assert.equal(sprintParts('Hardening week'), null);
  const cal = CAL.map((c, i) => ({ ...c, boards: { 'Data Platform': 8575 + i } }));
  const fut = (name: string, id: string | null = null) => ({ id, name, state: 'future' as const, startDate: null, endDate: null });
  assert.equal(mapSprint(fut('Data_Platform_2026_Q4_Sprint4'), cal), 'Q4 2026 Sprint 4');   // by name parts, no dates
  assert.equal(mapSprint(fut('Data_Platform_2026_Q3_Sprint4'), cal), null);                 // another quarter
  assert.equal(mapSprint(fut('Anything at all', '8576'), cal), 'Q4 2026 Sprint 5');         // by Jira sprint id
  // undated tickets get the calendar's dates, so the forecast orders Sprint 4 before Sprint 5
  const [t] = withCalendarDates([tk('X', { sprint: fut('Data_Platform_2026_Q4_Sprint5') })], cal);
  assert.deepEqual([t.sprint!.startDate, t.sprint!.endDate], ['2026-11-27', '2026-12-10']);
});

test('people: one window, done-only people not counted ahead, late flagged', () => {
  const ts = [
    tk('A-1', { assigneeId: 'a', originalDays: 12 }),                                  // a: open work
    tk('D-1', { assigneeId: 'd', originalDays: 3, remainingDays: 0, done: true }),     // d: finished their part
    tk('U-1', { originalDays: 1 }),                                                    // unassigned
  ];
  const day = dayOf({ 'a|2026-11-16': 1 });
  const h = evaluateProject(PR, [E1], ts, same, day, '2026-11-01');
  const a = h.people.find((x) => x.id === 'a')!, d = h.people.find((x) => x.id === 'd')!;
  // working − leave = available, same window
  assert.equal(a.workingAhead - a.leaveAhead, a.availableAhead);
  assert.deepEqual([a.workingAhead, a.leaveAhead, a.availableAhead], [10, 1, 9]);
  assert.equal(a.active, true);
  assert.equal(a.openTickets, 1);
  assert.equal(d.active, false);
  // team ahead = active people only; d's 10 free days don't hide a's overload
  assert.equal(h.availableAhead, 9);
  assert.equal(h.ticketFinish['U-1'], '2026-12-02'); // queued behind a (done 1 Dec), not handed to d
  assert.equal(a.lateDays, 3);                       // a: 13 days of work, 9 available
  assert.equal(h.people[0].id, 'a');                 // people with open work listed first
});

test('progress: one cut-off (start of today), delivered estimate only, carried-in work set apart', () => {
  const old = { name: 'Q3 Sprint 6', state: 'closed' as const, startDate: '2026-09-18', endDate: '2026-10-01' };
  const ts = [
    tk('O-1', { assigneeId: 'a', originalDays: 6, remainingDays: 0, done: true, sprint: old }),                  // delivered before the window
    tk('N-1', { assigneeId: 'a', originalDays: 2, remainingDays: 0, done: true, resolvedDate: '2026-10-20' }),  // no sprint, resolved before
    tk('W-1', { assigneeId: 'a', originalDays: 2, remainingDays: 0, done: true, resolvedDate: '2026-11-17' }),  // delivered in the window
    tk('X-1', { assigneeId: 'a', originalDays: 1, remainingDays: 0, done: true, resolvedDate: '2026-11-19' }),  // delivered today
    tk('Y-1', { assigneeId: 'a', originalDays: 4, remainingDays: 2 }),                                          // open, 2 d burned: not counted
  ];
  const h = evaluateProject(PR, [E1], ts, same, dayOf(), '2026-11-19'); // Thu: 13, 16, 17, 18 have passed
  assert.equal(h.burned, 4);                 // capacity used up to the start of today
  assert.equal(h.carriedIn, 8);
  assert.equal(h.workDone, 2);               // W-1 only: X-1 counts from tomorrow, Y-1's partial burn has no date
  assert.equal(h.deliveredToday, 1);
  assert.equal(h.workTaken, 7);              // 15 estimate − 8 delivered before the start
  assert.equal(h.windowDonePct, 0.29);       // 2 of 7
  assert.equal(h.workDonePct, 0.73);         // overall: 11 of 15 delivered
  assert.equal(h.firstWorkDate, '2026-09-18');
  assert.deepEqual(h.pace, { rate: 0.5, capacityNeeded: 4 }); // 2 d delivered in 4 d of capacity; 2 d remaining
  // day one: nothing used yet → no pace, and nothing counted as done in the window
  const fresh = evaluateProject(PR, [E1], ts, same, dayOf(), '2026-11-13');
  assert.equal(fresh.burned, 0);
  assert.equal(fresh.capacityUsedPct, 0);
  assert.equal(fresh.workDone, 0);
  assert.equal(fresh.pace, null);
});

test('progress: the window team excludes people whose work all finished before the start', () => {
  const old = { name: 'Q3 Sprint 6', state: 'closed' as const, startDate: '2026-09-18', endDate: '2026-10-01' };
  const ts = [tk('A-1', { assigneeId: 'a', originalDays: 3 }), tk('Z-1', { assigneeId: 'z', originalDays: 5, remainingDays: 0, done: true, sprint: old })];
  const h = evaluateProject(PR, [E1], ts, same, dayOf(), '2026-11-19');
  assert.equal(h.team, 1);
  assert.equal(h.available, 10);             // a only — z's days don't inflate capacity
  assert.equal(h.burned, 4);
});

test('progress: a ticket resolved inside the window stays in it, sprint or not', () => {
  const ts = [tk('K-1', { assigneeId: 'a', originalDays: 3, remainingDays: 0, done: true, resolvedDate: '2026-11-17' }),
    tk('K-2', { assigneeId: 'a', originalDays: 3, remainingDays: 3 })];
  const h = evaluateProject(PR, [E1], ts, same, dayOf(), '2026-11-19');
  assert.equal(h.carriedIn, 0);
  assert.equal(h.workDone, 3);
  assert.equal(h.windowDonePct, 0.5);
});

test('people: leave dates behind the leave total', () => {
  const ts = [tk('A-1', { assigneeId: 'a', originalDays: 3 })];
  const day = dayOf({ 'a|2026-11-16': 1, 'a|2026-11-17': 1, 'a|2026-11-20': 0.5 });
  const h = evaluateProject(PR, [E1], ts, same, day, '2026-11-01');
  const a = h.people[0];
  assert.deepEqual(a.leaveDatesAhead, [{ day: '2026-11-16', out: 1 }, { day: '2026-11-17', out: 1 }, { day: '2026-11-20', out: 0.5 }]);
  assert.equal(a.leaveDatesAhead.reduce((s, d) => s + d.out, 0), a.leaveAhead); // dates add up to the total
});

// ---- forecast report: parity with the epic-capacity-forecast skill ----------------
// forecast-report.md is the skill's own compute.py output for the same input.
test('forecast report: identical to the skill (tables, rounding, change table, snapshot)', async () => {
  const { buildReport, parseSnapshot } = await import('../backend/domain/forecastReport.ts');
  const raw = fx('forecast-issues.json');
  const byKey = new Map(raw.map((x: any) => [x.key, x]));
  const epicOf = (x: any): string => (x.parent.startsWith('EP-') ? x.parent : epicOf(byKey.get(x.parent)));
  const tickets = raw.map((x: any, i: number) => ({
    key: x.key, summary: '', status: x.status, done: x.category === 'done', epicKey: epicOf(x), assigneeId: null, assigneeName: null,
    originalDays: null, remainingDays: null, origSec: x.orig, remSec: x.rem, resolution: x.resolution, rank: i, sprint: null,
    sprints: x.sprints.map((s: any) => ({ id: String(s.id), name: s.name, state: s.state, startDate: null, endDate: null })),
  }));
  const cal = [
    { name: 'Q4 2026 Sprint 4', startDate: '2026-11-13', endDate: '2026-11-26', boards: { 'Data Platform': 8575 } },
    { name: 'Q4 2026 Sprint 5', startDate: '2026-11-27', endDate: '2026-12-10', boards: { 'Data Platform': 8576 } },
    { name: 'Q4 2026 Sprint 6', startDate: '2026-12-11', endDate: '2026-12-24', boards: { 'Data Platform': 8577 } },
  ];
  const r = buildReport({
    project: 'Parity', date: '2026-11-13', tickets, cal, engineers: 4,
    epics: [{ key: 'EP-1', summary: 'M2 Block indexing', status: '', done: false, dueDate: null }, { key: 'EP-2', summary: 'M3 Record-scoped search', status: '', done: false, dueDate: null }],
    sprints: [{ name: 'Q4 2026 Sprint 4', label: 'Sprint 4', days: 8, capacity: 32 }, { name: 'Q4 2026 Sprint 5', label: 'Sprint 5', days: 8, capacity: 32 }],
    prev: parseSnapshot(JSON.stringify(fx('forecast-prev.json'))),
  });
  assert.equal(r.markdown, readFileSync(new URL('./fixtures/forecast-report.md', import.meta.url), 'utf8'));
  assert.equal(r.snapshot.rt, 13.75);
  assert.deepEqual(r.snapshot.t['LP-5'], [43200, 43200, 'c']);
  assert.throws(() => parseSnapshot('not json'));
  // the per-person split (unassigned here) adds up to the table's total
  const split = Object.values(r.loadByPerson).reduce((t, x) => t + x.sprints.reduce((a, b) => a + b, 0) + x.none, 0);
  assert.ok(Math.abs(split - r.totalRemaining) < 1e-9);
});

test('progress: measured from Sprint 1 when that is earlier than the project start', () => {
  const s1 = { name: 'Q4 2026 Sprint 1', state: 'closed' as const, startDate: '2026-10-02', endDate: '2026-10-15' };
  const ts = [
    tk('D-1', { assigneeId: 'a', originalDays: 5, remainingDays: 0, done: true, resolvedDate: '2026-10-09', sprint: s1 }), // delivered in Sprint 1
    tk('O-1', { assigneeId: 'a', originalDays: 5 }),
  ];
  const own = evaluateProject(PR, [E1], ts, same, dayOf(), '2026-11-19');
  assert.equal(own.progressFrom, '2026-11-13');
  assert.equal(own.carriedIn, 5); // before the project start
  assert.equal(own.workDone, 0);
  const s1on = evaluateProject(PR, [E1], ts, same, dayOf(), '2026-11-19', { progressFrom: '2026-10-02' });
  assert.equal(s1on.progressFrom, '2026-10-02');
  assert.equal(s1on.carriedIn, 0);
  assert.equal(s1on.workDone, 5);             // Sprint 1's delivery now counts
  assert.equal(s1on.workTaken, 10);
  assert.equal(s1on.burned, 34);              // 2 Oct → 18 Nov: 34 weekdays
  assert.equal(s1on.available, 40);           // 2 Oct → 26 Nov
  // a later "progressFrom" never moves the start forward
  assert.equal(evaluateProject(PR, [E1], ts, same, dayOf(), '2026-11-19', { progressFrom: '2026-12-01' }).progressFrom, '2026-11-13');
});

// ---- people allocation ------------------------------------------------------------
test('allocation: one person across two projects, per sprint, after their own leave', () => {
  const S4 = { name: 'Q4 2026 Sprint 4', state: 'active' as const, startDate: '2026-11-13', endDate: '2026-11-26' };
  const S5 = { name: 'Q4 2026 Sprint 5', state: 'future' as const, startDate: null, endDate: null };
  const E2: ProjectEpic = { key: 'E-2', summary: 'Epic two', status: 'To Do', done: false, dueDate: null };
  const shared = tk('T-3', { epicKey: 'E-1', assigneeId: 'a', originalDays: 2, remainingDays: 2, sprint: S5 });
  const sources = [
    { projectId: 'p1', projectName: 'One', epics: [E1], tickets: [
      tk('T-1', { assigneeId: 'a', originalDays: 4, remainingDays: 1, sprint: S4 }), // 3 burned + 1 left
      shared,
      tk('T-5', { assigneeId: 'a', originalDays: 1, remainingDays: 1 }),           // no sprint → backlog
      tk('T-6', { originalDays: 2, remainingDays: 2, sprint: S4 }),                // unassigned
    ] },
    { projectId: 'p2', projectName: 'Two', epics: [E2, E1], tickets: [
      tk('T-2', { epicKey: 'E-2', assigneeId: 'a', originalDays: 5, remainingDays: 5, sprint: S4 }),
      shared, // linked to both projects: counted once
      tk('T-4', { epicKey: 'E-2', assigneeId: 'b', originalDays: 1, remainingDays: 0, done: true, sprint: S4 }),
    ] },
  ];
  // a: 2 days of leave in Sprint 4 (one of them half) → 10 working, 1.5 leave, 8.5 available
  const day = dayOf({ 'a|2026-11-16': 1, 'a|2026-11-17': 0.5 });
  const r = allocation(sources, CAL, same, day, '2026-11-19', '2026-11-26');
  assert.deepEqual(r.sprints.map((s) => [s.name, s.state]), [['Q4 2026 Sprint 4', 'active'], ['Q4 2026 Sprint 5', 'future']]); // S5 kept: open work there
  const a = r.people.find((p) => p.id === 'a')!;
  const [c4, c5] = a.cells;
  assert.deepEqual([c4.working, c4.leave, c4.available], [10, 1.5, 8.5]);
  assert.deepEqual(c4.leaveDates, [{ day: '2026-11-16', out: 1 }, { day: '2026-11-17', out: 0.5 }]);
  assert.deepEqual(c4.items.map((i) => [i.epicKey, i.jira, i.remaining]), [['E-2', 5, 5], ['E-1', 4, 1]]);
  assert.equal(c4.jira, 9);
  assert.equal(Math.round(c4.load * 1000) / 1000, 1.059); // 9 ÷ 8.5 → over
  assert.equal(c4.band, 'red');
  assert.equal(c4.availableAhead, 6);       // Thu 19 – Thu 26: 6 working days, no leave left
  assert.equal(c4.loadAhead, 1);            // 6 left ÷ 6 ahead
  assert.deepEqual([c5.available, c5.jira, c5.items.length], [10, 2, 1]);
  assert.deepEqual(a.backlog, { remaining: 1, tickets: 1, items: [{ epicKey: 'E-1', jira: 1, done: 0, remaining: 1, tickets: 1, open: 1 }] });
  assert.deepEqual(a.epics, ['E-1', 'E-2']); // most days first: E-1 4+2+1, E-2 5
  assert.deepEqual(a.projects.sort(), ['p1', 'p2']);
  // epic E-1 knows both projects; unassigned work is kept apart
  assert.deepEqual(r.epics.find((e) => e.key === 'E-1')!.projects.map((p) => p.id), ['p1', 'p2']);
  assert.deepEqual(r.unassigned[0], { jira: 2, remaining: 2, tickets: 1 });
  // b only has a done ticket in S4: still on the board for that sprint
  const b = r.people.find((p) => p.id === 'b')!;
  assert.deepEqual([b.cells[0].jira, b.cells[0].remaining, b.cells[1].tickets], [1, 0, 0]);
});

// ---- projects side bar: capacity burn across projects ------------------------------
test('burn: per sprint across projects, each person counted once', () => {
  const person = (id: string, available: number, elapsed: number, assigned = true) => ({ id, working: 10, leave: 10 - available, available, elapsed, assigned });
  const sp = (name: string, startDate: string, state: 'past' | 'active' | 'future', x: Partial<Parameters<typeof mergeBurn>[0][0]['sprints'][0]>) =>
    ({ name, startDate, endDate: startDate, state, available: 0, done: 0, committed: 0, remaining: 0, tickets: 0, open: 0, assignedPeople: 0, people: [], ...x });
  const r = mergeBurn([
    { id: 'p1', name: 'One', sprints: [
      sp('S3', '2026-10-30', 'past', { available: 10, done: 6, committed: 6, tickets: 2, assignedPeople: 1, people: [person('a', 10, 10)] }),
      sp('S4', '2026-11-13', 'active', { available: 18, done: 4, committed: 12, remaining: 8, tickets: 3, open: 2, assignedPeople: 2, people: [person('a', 8, 4), person('b', 10, 5)] }),
      sp('S5', '2026-11-27', 'future', {}), // no tickets: left out
    ] },
    { id: 'p2', name: 'Two', sprints: [
      sp('S4', '2026-11-13', 'active', { available: 8, done: 1, committed: 6, remaining: 5, tickets: 1, open: 1, assignedPeople: 1,
        people: [person('a', 8, 4), person('c', 10, 5, false)] }), // a again; c has no ticket here
    ] },
  ]);
  assert.deepEqual(r.sprints.map((s) => s.name), ['S3', 'S4']);
  const s4 = r.sprints[1];
  assert.deepEqual([s4.people, s4.available, s4.elapsed, s4.done, s4.committed, s4.remaining], [2, 18, 9, 5, 18, 13]); // a once, not 26 d
  assert.equal(Math.round(s4.burnedPct! * 100), 28);
  assert.equal(s4.load, 1);
  assert.equal(s4.pace, 'behind'); // 28% burned vs 50% of the time passed
  assert.deepEqual(s4.parts.map((p) => [p.name, p.available, p.committed]), [['One', 18, 12], ['Two', 8, 6]]);
  assert.deepEqual([r.total.available, r.total.elapsed, r.total.done, r.total.committed], [28, 19, 11, 24]);
  assert.deepEqual(mergeBurn([]).total, { sprints: 0, available: 0, elapsed: 0, done: 0, committed: 0, remaining: 0, burnedPct: 0, elapsedPct: 0, load: 0 });
});

// ---- baseline: the project's high-level original estimate --------------------------
test('baseline: project issue estimate first, else the epics’ own, else none', () => {
  // COS-3815-like: 1,015,200 s on the project issue = 47 d of 6 h; tickets now 75.34 d
  const e = mapEpic({ key: 'E-1', fields: { summary: 'x', status: { name: 'Done', statusCategory: { key: 'done' } }, timeoriginalestimate: 172800 } })!;
  assert.equal(e.estimateDays, 8);
  assert.deepEqual(baselineOf({ estimateDays: 47 }, [e], 75.34), { days: 47, source: 'project', epicSum: 8, tickets: 75.34, growth: 28.34, growthPct: 0.603, fetched: true });
  // an Idea has no estimate: fall back to its epics' own
  assert.deepEqual(baselineOf({ estimateDays: null }, [{ estimateDays: 8 }, { estimateDays: null }, { estimateDays: 12 }], 18), { days: 20, source: 'epics', epicSum: 20, tickets: 18, growth: -2, growthPct: -0.1, fetched: true });
  // nothing estimated anywhere
  assert.equal(baselineOf({ estimateDays: null }, [{ estimateDays: null }], 5).days, null);
  // a snapshot from before estimates were read: ask for a refresh
  assert.equal(baselineOf({}, [{}], 5).fetched, false);
});

// ---- estimate by quarter label ------------------------------------------------------
test('quarters: labels parsed; estimate split by epic label, multi-quarter epics by sprint', () => {
  assert.deepEqual(quarterLabels(['Q4-2026', 'block-join', 'q3_2026', 'Q3 2026', 'nested-json']), ['Q3-2026', 'Q4-2026']);
  assert.deepEqual(quarterLabels(undefined), []);
  const S = (name: string) => ({ name, state: 'closed' as const, startDate: null, endDate: null });
  const ep = (key: string, quarters?: string[]): ProjectEpic => ({ key, summary: key, status: '', done: false, dueDate: null, quarters });
  const epics = [ep('A', ['Q3-2026']), ep('B', ['Q3-2026', 'Q4-2026']), ep('C')];
  const r = quarterTotals(epics, [
    tk('A-1', { epicKey: 'A', originalDays: 4, remainingDays: 0, done: true }),
    tk('B-1', { epicKey: 'B', originalDays: 3, remainingDays: 0, done: true, sprint: S('Data_Platform_2026_Q3_Sprint6') }), // → Q3
    tk('B-2', { epicKey: 'B', originalDays: 5, remainingDays: 2, sprint: S('Q4 2026 Sprint 4') }),                         // → Q4
    tk('B-3', { epicKey: 'B', originalDays: 1, remainingDays: 1 }),                                                        // no sprint → latest (Q4)
    tk('C-1', { epicKey: 'C', originalDays: 2, remainingDays: 2 }),                                                        // unlabelled
  ]);
  assert.deepEqual(r.map((q) => [q.quarter, q.epics, q.estimate, q.done, q.remaining]), [
    ['Q3-2026', ['A', 'B'], 7, 7, 0],
    ['Q4-2026', ['B'], 6, 3, 3],
    [null, ['C'], 2, 0, 2],
  ]);
  assert.equal(r.reduce((a, q) => a + q.estimate, 0), 15); // parts add up to the total
  assert.deepEqual(quarterTotals([ep('X')], [tk('X-1', { epicKey: 'X', originalDays: 1 })]), []); // no labels anywhere: nothing to split
});

// ---- a closed epic closes its open tickets ------------------------------------------
test('closed epic: open tickets closed out — 0 remaining, 100% done, in health and the report', () => {
  // LP-76914-like: closed epic, 8 d delivered, 2 tickets (6 d) left open in Jira, one cancelled
  const epic: ProjectEpic = { key: 'E-9', summary: 'Spike', status: 'Closed', done: true, dueDate: null, estimateDays: 16 };
  const open1 = tk('T-91', { epicKey: 'E-9', originalDays: 4, remainingDays: 4, origSec: 4 * 21600, remSec: 4 * 21600 });
  const raw = [
    tk('T-90', { epicKey: 'E-9', originalDays: 8, remainingDays: 0, done: true, resolution: 'Done', origSec: 8 * 21600, remSec: 0 }),
    open1,
    tk('T-92', { epicKey: 'E-9', originalDays: 2, remainingDays: 2, origSec: 2 * 21600, remSec: 2 * 21600 }),
    tk('T-93', { epicKey: 'E-9', originalDays: 6, remainingDays: 0, done: true, resolution: 'Invalid', origSec: 6 * 21600, remSec: 0 }),
  ];
  const ts = closeWithEpics([epic], raw);
  assert.equal(raw[1].closedWithEpic, undefined); // input untouched
  assert.deepEqual(ts.map((x) => !!x.closedWithEpic), [false, true, true, false]);
  assert.deepEqual([...closedOutByEpic(ts)], [['E-9', { tickets: 2, days: 6, keys: ['T-91', 'T-92'], subtasks: 0, parents: [] }]]);
  // health: cancelled + closed-out tickets are left out → 8 of 8 d, nothing remaining
  const live = ts.filter((x) => !x.closedWithEpic && !(x.done && x.resolution === 'Invalid'));
  assert.deepEqual([workTotals(live).done, workTotals(live).remaining, workTotals(live).current], [8, 0, 8]);
  // the report row: 8 active, 8 delivered, 0 remaining → 100%
  const r = buildReport({ project: 'x', date: '2026-11-17', epics: [epic], tickets: ts, sprints: [], engineers: 0, cal: [], prev: null });
  assert.deepEqual([r.epics[0].est, r.epics[0].done, r.epics[0].rem], [8, 8, 0]);
  // an open epic keeps its open tickets
  assert.equal(closeWithEpics([{ ...epic, done: false }], [open1])[0].closedWithEpic, undefined);
});

test('closed story: its open sub-tasks are closed out even when the epic is open', () => {
  // LP-76918-like: a story closed as Invalid, two sub-tasks never closed (invisible in Jira's epic view)
  const epic: ProjectEpic = { key: 'E-5', summary: 'x', status: 'In Progress', done: false, dueDate: null };
  const ts = closeWithEpics([epic], [
    tk('S-1', { epicKey: 'E-5', originalDays: 6, remainingDays: 0, done: true, resolution: 'Invalid' }),
    tk('S-2', { epicKey: 'E-5', originalDays: 4, remainingDays: 4, subtask: true, parentKey: 'S-1' }),
    tk('S-3', { epicKey: 'E-5', originalDays: 2, remainingDays: 2, subtask: true, parentKey: 'S-1' }),
    tk('S-4', { epicKey: 'E-5', originalDays: 3, remainingDays: 3 }),                               // open story: stays open
    tk('S-5', { epicKey: 'E-5', originalDays: 1, remainingDays: 1, subtask: true, parentKey: 'S-4' }), // sub-task of an open story: stays
  ]);
  assert.deepEqual(ts.map((x) => x.closedBy ?? null), [null, 'story', 'story', null, null]);
  assert.deepEqual(closedOutByEpic(ts).get('E-5'), { tickets: 2, days: 6, keys: ['S-2', 'S-3'], subtasks: 2, parents: ['S-1'] });
});

// ---- actual available capacity: max 8 d a person a sprint ---------------------------
test('schedulable: available, capped at 8 d a sprint, scaled for the part left', () => {
  const [a, b] = ['2026-11-13', '2026-11-26']; // Fri 13 – Thu 26: 10 weekdays
  assert.equal(schedulable(10, a, b, a, b), 8);       // full sprint, no leave → 8, not 10
  assert.equal(schedulable(6.5, a, b, a, b), 6.5);    // leave brings them under the cap → their available days
  assert.equal(schedulable(6, '2026-11-19', b, a, b), 4.8); // from Thu 19: 6 of 10 weekdays left → cap 4.8
  assert.equal(schedulable(3, '2026-11-19', b, a, b), 3);
  assert.equal(schedulable(0, a, b, a, b), 0);
});
