// Talent Grid domain: bands at every boundary, weighted averages, moves,
// layout round-trips, CSV and backup (PRD §9.1 acceptance list).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  avgX100, bandIndex, bandName, boxesInMatrixOrder, boxRangeText, CRITERION_IDS, DEFAULT_COPY, defaultWeightTable, employeeErrors,
  equalWeights, linkToRoster, mergeCopy, parseBackup, place, ratingsForBox, talentCsv, weightsError, zoneOf, BACKUP_KIND,
  type Ratings, type TalentEmployee, type Weights,
} from '../backend/domain/talent.ts';

const R = (perf: number[], pot: number[]): Ratings => Object.fromEntries(CRITERION_IDS.map((c, i) => [c, i < 5 ? perf[i] : pot[i - 5]])) as Ratings;
const W = (perf: number[], pot: number[]): Weights => R(perf, pot) as unknown as Weights;

test('every average 1.00–5.00 falls in exactly one band, boundaries included', () => {
  for (let x = 100; x <= 500; x++) {
    assert.ok(bandIndex(3, x) >= 0 && bandIndex(3, x) < 3);
    assert.ok(bandIndex(4, x) >= 0 && bandIndex(4, x) < 4);
  }
  // 3×3
  assert.equal(bandName(3, 299), 'Low'); assert.equal(bandName(3, 300), 'Medium');
  assert.equal(bandName(3, 399), 'Medium'); assert.equal(bandName(3, 400), 'High');
  assert.equal(bandName(3, 100), 'Low'); assert.equal(bandName(3, 500), 'High');
  // 4×4
  assert.equal(bandName(4, 249), 'Low'); assert.equal(bandName(4, 250), 'Moderate');
  assert.equal(bandName(4, 349), 'Moderate'); assert.equal(bandName(4, 350), 'High');
  assert.equal(bandName(4, 424), 'High'); assert.equal(bandName(4, 425), 'Exceptional');
});

test('box labels: A and 1 are highest; range text', () => {
  assert.deepEqual(boxesInMatrixOrder(3), ['C1', 'B1', 'A1', 'C2', 'B2', 'A2', 'C3', 'B3', 'A3']);
  assert.equal(boxesInMatrixOrder(4).length, 16);
  assert.equal(boxRangeText(3, 'B1'), 'Perf 3.00–3.99 · Pot 4.00–5.00');
  assert.equal(boxRangeText(4, 'A4'), 'Perf 4.25–5.00 · Pot 1.00–2.49');
  assert.equal(place(R([5, 5, 5, 5, 5], [5, 5, 5, 5, 5]), equalWeights(), 3).box, 'A1');
  assert.equal(place(R([1, 1, 1, 1, 1], [1, 1, 1, 1, 1]), equalWeights(), 4).box, 'D4');
});

test('zones per layout', () => {
  assert.equal(zoneOf(3, 'B3'), 'core'); assert.equal(zoneOf(3, 'C2'), 'watch'); assert.equal(zoneOf(3, 'C3'), 'risk');
  assert.equal(zoneOf(4, 'C4'), 'watch'); assert.equal(zoneOf(4, 'D3'), 'risk'); assert.equal(zoneOf(4, 'A4'), 'core');
  for (const l of [3, 4] as const) for (const b of boxesInMatrixOrder(l)) assert.ok(DEFAULT_COPY[l][b].actions.length === 5, `${l} ${b}`);
});

test('weighted averages are exact and stay on the 1–5 scale', () => {
  const r = R([4, 3, 3, 3, 3], [5, 1, 1, 1, 1]);
  assert.equal(avgX100(r, equalWeights(), 'perf'), 320);
  // Leadership-heavy Lead weights: same ratings, different box
  const lead = W([20, 20, 20, 20, 20], [10, 10, 10, 10, 60]);
  const rr = R([3, 3, 3, 3, 3], [3, 3, 3, 3, 5]);
  assert.equal(avgX100(rr, equalWeights(), 'pot'), 340);
  assert.equal(avgX100(rr, lead, 'pot'), 420);
  assert.equal(place(rr, equalWeights(), 3).box, 'B2');
  assert.equal(place(rr, lead, 3).box, 'B1');
  // 3.49 vs 3.50 at 4×4 (High starts at 3.50)
  const w = W([50, 50, 0, 0, 0], [20, 20, 20, 20, 20]);
  assert.equal(bandName(4, avgX100(R([3, 4, 1, 1, 1], [3, 3, 3, 3, 3]), w, 'perf')), 'High'); // 3.50
});

test('weights must total 100% per axis, whole percents', () => {
  assert.equal(weightsError(equalWeights()), null);
  assert.match(weightsError(W([20, 20, 20, 20, 21], [20, 20, 20, 20, 20]))!, /101%/);
  assert.match(weightsError({ ...equalWeights(), quality: 20.5 })!, /whole percent/);
});

test('switching 3×3 → 4×4 → 3×3 never changes ratings or the 3×3 box', () => {
  const r = R([4, 4, 3, 5, 4], [2, 3, 4, 3, 3]);
  const before = { ...r };
  const a = place(r, equalWeights(), 3).box;
  place(r, equalWeights(), 4);
  assert.equal(place(r, equalWeights(), 3).box, a);
  assert.deepEqual(r, before);
});

test('a move changes only the axis that changed and lands in the chosen box', () => {
  const w = equalWeights();
  for (const layout of [3, 4] as const) {
    for (const start of [R([3, 3, 3, 3, 3], [3, 3, 3, 3, 3]), R([1, 2, 5, 4, 3], [5, 4, 2, 1, 3]), R([5, 5, 5, 5, 5], [1, 1, 1, 1, 1])]) {
      const from = place(start, w, layout);
      for (const box of boxesInMatrixOrder(layout)) {
        const next = ratingsForBox(start, w, layout, box);
        const to = place(next, w, layout);
        assert.equal(to.box, box, `${layout}×${layout} → ${box}`);
        if (to.perfIdx === from.perfIdx) for (const c of CRITERION_IDS.slice(0, 5)) assert.equal(next[c], start[c]);
        if (to.potIdx === from.potIdx) for (const c of CRITERION_IDS.slice(5)) assert.equal(next[c], start[c]);
        for (const c of CRITERION_IDS) assert.ok(next[c] >= 1 && next[c] <= 5 && Number.isInteger(next[c]));
      }
    }
  }
  // with skewed weights too
  const lead = W([40, 15, 15, 15, 15], [10, 10, 10, 10, 60]);
  const s = R([2, 3, 3, 2, 3], [3, 2, 3, 3, 2]);
  for (const box of boxesInMatrixOrder(4)) assert.equal(place(ratingsForBox(s, lead, 4, box), lead, 4).box, box);
});

test('employee validation: name 2–80, all 10 ratings, notes ≤ 2000', () => {
  const ok = { name: 'Ana', role: '', level: 'se', ratings: R([3, 3, 3, 3, 3], [3, 3, 3, 3, 3]), notes: '' };
  assert.deepEqual(employeeErrors(ok), {});
  assert.ok(employeeErrors({ ...ok, name: 'A' }).name);
  assert.ok(employeeErrors({ ...ok, name: 'x'.repeat(81) }).name);
  assert.match(employeeErrors({ ...ok, ratings: { ...ok.ratings, quality: 0 } }).ratings!, /Quality/);
  assert.ok(employeeErrors({ ...ok, notes: 'x'.repeat(2001) }).notes);
  assert.ok(employeeErrors({ ...ok, level: 'cto' }).level);
});

const emp = (name: string, r: Ratings): TalentEmployee => ({
  id: 'id-' + name, name, role: 'Backend', level: 'se', ratings: r, notes: 'n', rev: 3,
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  history: [{ at: '2026-11-01T00:00:00.000Z', by: 'EM', cause: 'created', layout: 3, box: 'B2', perf: 300, pot: 300, level: 'se', ratings: r, weights: equalWeights() }],
});

test('CSV: BOM, both layouts, accents, formula guard', () => {
  const csv = talentCsv([emp('Zoë Ångström', R([5, 5, 5, 5, 5], [3, 3, 3, 3, 3])), emp('=cmd', R([1, 1, 1, 1, 1], [1, 1, 1, 1, 1]))], defaultWeightTable());
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.slice(1).trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /Box \(3×3\).*Box \(4×4\)/);
  assert.ok(lines.some((l) => l.startsWith("'=cmd")));
  assert.ok(lines.some((l) => l.startsWith('Zoë Ångström,,Backend,Software Engineer,5.00,High,Exceptional,3.00,Medium,Moderate,A2,High Performers,A3,Trusted Expert')));
});

test('backup round-trips with nothing lost; invalid records are skipped and counted', () => {
  const a = emp('Ana', R([4, 4, 4, 4, 4], [2, 2, 2, 2, 2]));
  const json = JSON.parse(JSON.stringify({ kind: BACKUP_KIND, version: 1, weights: defaultWeightTable(), employees: [a, { name: 'X' }, { ...a, id: 'b', ratings: {} }] }));
  const r = parseBackup(json);
  assert.equal(r.employees.length, 1);
  assert.equal(r.skipped, 2);
  const back = r.employees[0];
  assert.equal(back.id, a.id); assert.equal(back.notes, a.notes); assert.deepEqual(back.ratings, a.ratings);
  assert.deepEqual(back.history, a.history);
  assert.throws(() => parseBackup({ hello: 1 }), /not a Talent Grid backup/);
});

test('copy overrides replace wording without touching the rest', () => {
  const c = mergeCopy({ 3: { A1: { title: 'Stars', actions: ['Do one thing'] } }, '4x4': { D4: { description: 'Changed.' } } });
  assert.equal(c[3].A1.title, 'Stars');
  assert.deepEqual(c[3].A1.actions, ['Do one thing']);
  assert.equal(c[3].A1.description, DEFAULT_COPY[3].A1.description);
  assert.equal(c[4].D4.description, 'Changed.');
  assert.equal(c[4].D4.title, 'Talent Risk');
});

test('records link to BambooHR team members by name, and names follow BambooHR', () => {
  const r3 = R([3, 3, 3, 3, 3], [3, 3, 3, 3, 3]);
  const list = [emp('ana  núñez', r3), emp('Ben', r3), { ...emp('Old Name', r3), bambooId: '7' }, emp('Dup', r3)];
  const roster = [
    { bambooId: '1', name: 'Ana Núñez', team: 'Core' }, { bambooId: '7', name: 'New Name', team: 'Core' },
    { bambooId: '8', name: 'Dup', team: 'A' }, { bambooId: '9', name: 'dup', team: 'B' },
  ];
  assert.equal(linkToRoster(list, roster), true);
  assert.equal(list[0].bambooId, '1'); assert.equal(list[0].name, 'Ana Núñez');
  assert.equal(list[1].bambooId, undefined);          // not in the team
  assert.equal(list[2].name, 'New Name');             // BambooHR rename followed
  assert.equal(list[3].bambooId, undefined);          // ambiguous: two matches, left alone
  assert.equal(linkToRoster(list, roster), false);    // stable
});
