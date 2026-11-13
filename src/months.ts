// Month ranges (inclusive YYYY-MM bounds, may cross a year) — shared by the
// month pickers on Long leave, List and Capacity.
import { addDays, addMonths } from '../backend/domain/dates.ts';

export interface MonthRange { from: string; to: string }

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const ym = (d: string) => d.slice(0, 7);
export const shiftMonth = (m: string, n: number) => {
  const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
export const monthName = (m: string, withYear: boolean, long = false) =>
  (long ? MONTHS_LONG : MONTHS)[Number(m.slice(5, 7)) - 1] + (withYear ? ' ' + m.slice(0, 4) : '');
export const normRange = (r: MonthRange): MonthRange => (r.from <= r.to ? r : { from: r.to, to: r.from });
/** first and last day of a month range */
export const monthDays = (r: MonthRange) => ({ from: `${r.from}-01`, to: addDays(addMonths(`${r.to}-01`, 1), -1) });
/** "2026", "Nov 2026", "Nov 2026 – Feb 2027", "Mar – Jun 2026" */
export function rangeLabel(r: MonthRange): string {
  const multiYear = r.from.slice(0, 4) !== r.to.slice(0, 4);
  if (r.from === r.to) return monthName(r.from, true);
  if (!multiYear && r.from.endsWith('-01') && r.to.endsWith('-12')) return r.from.slice(0, 4);
  return `${monthName(r.from, multiYear)} – ${monthName(r.to, true)}`;
}

export const MONTH_PRESETS: { id: string; label: string; range: (today: string) => MonthRange }[] = [
  { id: 'this-month', label: 'This month', range: (t) => ({ from: ym(t), to: ym(t) }) },
  { id: 'next-month', label: 'Next month', range: (t) => ({ from: shiftMonth(ym(t), 1), to: shiftMonth(ym(t), 1) }) },
  { id: 'next3', label: 'Next 3 months', range: (t) => ({ from: ym(t), to: shiftMonth(ym(t), 2) }) },
  { id: 'next6', label: 'Next 6 months', range: (t) => ({ from: ym(t), to: shiftMonth(ym(t), 5) }) },
  { id: 'next12', label: 'Next 12 months', range: (t) => ({ from: ym(t), to: shiftMonth(ym(t), 11) }) },
  { id: 'quarter', label: 'This quarter', range: (t) => { const q = Math.floor((+t.slice(5, 7) - 1) / 3) * 3; const f = `${t.slice(0, 4)}-${String(q + 1).padStart(2, '0')}`; return { from: f, to: shiftMonth(f, 2) }; } },
  { id: 'year', label: 'This year', range: (t) => ({ from: `${t.slice(0, 4)}-01`, to: `${t.slice(0, 4)}-12` }) },
  { id: 'nextyear', label: 'Next year', range: (t) => ({ from: `${+t.slice(0, 4) + 1}-01`, to: `${+t.slice(0, 4) + 1}-12` }) },
];
