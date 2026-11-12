// Demo mode: a fake BambooClient answering the same endpoints with
// synthetic, BambooHR-shaped JSON, so the whole pipeline (mappers, scoping,
// sync, views) can be tried without an API key. No real people: every name
// is "Demo Person NN". Deterministic per day.
import { addDays, addMonths, diffDays, isWeekend, minDate, today } from '../domain/dates.ts';
import type { BambooClient } from './client.ts';

export const DEMO_ME = '9000';
const LOCATIONS = ['Kathmandu', 'London', 'Copenhagen'];
const TYPES = [
  { id: '1', name: 'Vacation' }, { id: '2', name: 'Sick Leave' },
  { id: '3', name: 'Personal Day' }, { id: '4', name: 'Parental Leave' },
  { id: '5', name: 'Training' }, { id: '6', name: 'Work From Home' },
];

interface DemoEmp { id: string; displayName: string; location: string; supervisorEId: string; squad: string | null }

function people(): DemoEmp[] {
  const out: DemoEmp[] = [
    { id: '9001', displayName: 'Demo Lead A', location: 'Kathmandu', supervisorEId: DEMO_ME, squad: 'SOC Workflow' },
    { id: '9002', displayName: 'Demo Lead B', location: 'Copenhagen', supervisorEId: DEMO_ME, squad: 'Data Platform' },
    // outside my reporting line — must never show up
    { id: '9500', displayName: 'Other Org Person', location: 'London', supervisorEId: '9999', squad: null },
    { id: '9999', displayName: 'Other Manager', location: 'London', supervisorEId: '', squad: null },
  ];
  for (let i = 1; i <= 22; i++) {
    const soc = i <= 12;
    out.push({
      id: String(9100 + i),
      displayName: `Demo Person ${String(i).padStart(2, '0')}`,
      location: LOCATIONS[i % 3],
      supervisorEId: soc ? '9001' : '9002',
      squad: soc ? 'SOC Workflow' : 'Data Platform',
    });
  }
  return out;
}

export function demoSquads(): Record<string, string> {
  const m: Record<string, string> = {};
  for (const p of people()) if (p.squad) m[p.id] = p.squad;
  return m;
}

// small seeded PRNG so a demo looks the same all day
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

// approvals made in demo mode (the generator is deterministic, so remember them)
const demoStatus = new Map<string, string>();

function requests(): any[] {
  const t = today();
  const rand = rng(Number(t.replace(/-/g, '')));
  const from = minDate(addMonths(t, -3), t.slice(0, 4) + '-01-01'), span = diffDays(from, addMonths(t, 12));
  const out: any[] = [];
  let id = 50000;
  for (const p of people()) {
    const n = Math.round((4 + Math.floor(rand() * 5)) * span / 450);
    for (let k = 0; k < n; k++) {
      let start = addDays(from, Math.floor(rand() * span));
      while (isWeekend(start)) start = addDays(start, 1);
      const typ = TYPES[rand() < 0.6 ? 0 : Math.floor(rand() * TYPES.length)];
      const long = typ.name === 'Parental Leave' ? 20 : typ.name === 'Vacation' ? 1 + Math.floor(rand() * 9) : typ.name === 'Work From Home' ? 1 + Math.floor(rand() * 3) : 1;
      const half = long === 1 && rand() < 0.25;
      const dates: Record<string, string> = {};
      let d = start, left = long, end = start;
      while (left > 0) {
        if (!isWeekend(d)) { dates[d] = half ? '4' : '8'; left--; end = d; }
        d = addDays(d, 1);
      }
      const future = start > t;
      const r = rand();
      const status = future ? (r < 0.55 ? 'approved' : r < 0.88 ? 'requested' : r < 0.95 ? 'denied' : 'canceled')
        : (r < 0.9 ? 'approved' : 'canceled');
      const created = addDays(start < t ? start : t, -(3 + Math.floor(rand() * 40)));
      out.push({
        id: String(id++), employeeId: p.id,
        status: { status, lastChanged: created },
        name: p.displayName, start, end, created,
        type: { id: typ.id, name: typ.name },
        amount: { unit: 'hours', amount: String(Object.values(dates).reduce((a, v) => a + Number(v), 0)) },
        dates,
        notes: { employee: 'notes are never stored' },
      });
    }
  }
  // a sprinkle of work-from-home days around this month, so the dashboard's
  // WFH widgets have something to show
  for (const p of people()) {
    const n = Math.floor(rand() * 5) + Math.floor(span / 30);
    for (let k = 0; k < n; k++) {
      let d = addDays(from, Math.floor(rand() * span));
      while (isWeekend(d)) d = addDays(d, 1);
      const r = rand();
      out.push({
        id: String(id++), employeeId: p.id,
        status: { status: r < 0.75 ? 'approved' : r < 0.93 ? 'requested' : 'denied' },
        start: d, end: d, created: addDays(d < t ? d : t, -2), type: { id: '6', name: 'Work From Home' },
        amount: { unit: 'hours', amount: '8' }, dates: { [d]: '8' },
      });
    }
  }
  // a guaranteed overlap day next week in SOC Workflow, so alerts show
  let o = addDays(t, 7);
  while (isWeekend(o)) o = addDays(o, 1);
  for (const pid of ['9101', '9102', '9103', '9104']) {
    out.push({
      id: String(id++), employeeId: pid, status: { status: pid === '9104' ? 'requested' : 'approved' },
      start: o, end: o, created: addDays(t, -2), type: { id: '1', name: 'Vacation' },
      amount: { unit: 'hours', amount: '8' }, dates: { [o]: '8' },
    });
  }
  return out;
}

const HOLIDAYS = [
  { start: '2026-12-25', end: '2026-12-25', name: 'Christmas Day' },
  { start: '2027-01-01', end: '2027-01-01', name: "New Year's Day" },
];

export function createDemoClient(): BambooClient {
  const respond = async (path: string, query?: Record<string, string>) => {
    await new Promise((r) => setTimeout(r, 150));
    if (path.startsWith('employees/0')) return { id: DEMO_ME, displayName: 'Demo Manager' };
    if (path.startsWith('reports/custom') || path.startsWith('employees/directory')) {
      return { fields: [], employees: [{ id: DEMO_ME, displayName: 'Demo Manager', location: 'London', supervisorEId: '', status: 'Active' },
        ...people().map(({ squad: _s, ...e }) => ({ ...e, status: 'Active' })),
        // people who left — must never show up
        { id: '9190', displayName: 'Demo Leaver (inactive)', location: 'London', supervisorEId: '9001', status: 'Inactive', terminationDate: '2026-01-31' },
        { id: '9191', displayName: 'Demo Leaver (last day passed)', location: 'Kathmandu', supervisorEId: '9002', status: 'Active', terminationDate: addDays(today(), -10) },
      ] };
    }
    if (path.startsWith('meta/time_off/types')) return { timeOffTypes: TYPES };
    if (path.startsWith('time_off/requests')) {
      const s = query?.start ?? '0000', e = query?.end ?? '9999';
      const statuses = (query?.status ?? '').split(',');
      return requests().map((r) => (demoStatus.has(r.id) ? { ...r, status: { ...r.status, status: demoStatus.get(r.id) } } : r))
        .filter((r) => r.end >= s && r.start <= e && (!statuses[0] || statuses.includes(r.status.status)));
    }
    if (path.startsWith('time_off/whos_out')) {
      return HOLIDAYS.map((h, i) => ({ id: i + 1, type: 'holiday', ...h }));
    }
    throw new Error('demo: unknown path ' + path);
  };
  return {
    get: respond,
    post: (path, _body, query) => respond(path, query),
    put: async (path, body: any) => {
      await new Promise((r) => setTimeout(r, 300));
      const m = /^time_off\/requests\/([^/]+)\/status$/.exec(path);
      if (!m) throw new Error('demo: unknown path ' + path);
      demoStatus.set(decodeURIComponent(m[1]), String(body?.status));
      return null;
    },
  };
}
