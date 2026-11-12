// Calendar-date helpers. Dates are plain 'YYYY-MM-DD' strings in the
// employee's local calendar — never converted through time zones. Math runs
// on UTC midnights so DST can't shift a day.

const DAY_MS = 86_400_000;

export function parse(d: string): number {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
}

export function fmt(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export function isDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function addDays(d: string, n: number): string {
  return fmt(parse(d) + n * DAY_MS);
}

export function addMonths(d: string, n: number): string {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return fmt(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(day, last)));
}

export function diffDays(a: string, b: string): number {
  return Math.round((parse(b) - parse(a)) / DAY_MS);
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = parse(from), end = parse(to); t <= end; t += DAY_MS) out.push(fmt(t));
  return out;
}

export function isWeekend(d: string): boolean {
  const wd = new Date(parse(d)).getUTCDay();
  return wd === 0 || wd === 6;
}

/** today on this Mac's local calendar */
export function today(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function maxDate(a: string, b: string): string { return a > b ? a : b; }
export function minDate(a: string, b: string): string { return a < b ? a : b; }
