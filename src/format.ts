// Display formatting (Intl lives in the page; the backend has none).
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const shortFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const wdFmt = new Intl.DateTimeFormat(undefined, { weekday: 'narrow', timeZone: 'UTC' });
const monFmt = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const utc = (d: string) => new Date(d + 'T00:00:00Z');

export const fmtDay = (d: string) => dayFmt.format(utc(d));
export const fmtShort = (d: string) => shortFmt.format(utc(d));
export const fmtWeekday = (d: string) => wdFmt.format(utc(d));
export const fmtMonth = (d: string) => monFmt.format(utc(d));
export const dayNum = (d: string) => String(+d.slice(8, 10));

export function fmtRange(a: string, b: string) {
  return a === b ? fmtDay(a) : `${fmtShort(a)} – ${fmtShort(b)}`;
}

export function fmtDays(n: number) {
  return n === 0.5 ? '½ day' : `${+n.toFixed(2)} ${n === 1 ? 'day' : 'days'}`;
}

export function fmtAgo(iso: string | null, now = Date.now()) {
  if (!iso) return 'never';
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  const d = new Date(iso);
  return new Date().toDateString() === d.toDateString() ? `today ${timeFmt.format(d)}` : dateTimeFmt.format(d);
}

export function fmtUptime(s: number) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export const STATUS_LABEL: Record<string, string> = { planned: 'Planned', draft: 'Draft', denied: 'Denied', canceled: 'Canceled' };

export const isWeekendDay = (d: string) => { const w = utc(d).getUTCDay(); return w === 0 || w === 6; };

/** THE way a sprint is named on screen, everywhere: "Q4 2026 Sprint 4" →
 *  "Q4 Sprint 4" (numbers restart each quarter, so the quarter stays; the
 *  year shows in the hover title, which keeps the full name). Names that
 *  don't follow the "Qn yyyy Sprint n" pattern show unchanged. */
export function sprintName(name: string): string {
  const q = /\b(Q[1-4])\b.*?\bsprint\s*(\d+)/i.exec(name);
  if (q) return `${q[1].toUpperCase()} Sprint ${q[2]}`;
  return name;
}

/** next weekday after d (YYYY-MM-DD) */
const nextWeekday = (d: string) => {
  let t = Date.parse(d + 'T00:00:00Z');
  do t += 86_400_000; while ([0, 6].includes(new Date(t).getUTCDay()));
  return new Date(t).toISOString().slice(0, 10);
};
/** leave dates → ranges: consecutive full days join ("Nov 16 – Nov 18"; a
 *  weekend inside doesn't break a run), part days stand alone ("Nov 20 ½") */
export function leaveRanges(list: { day: string; out: number }[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.out < 1) { out.push(`${fmtShort(a.day)} ${a.out === 0.5 ? '½' : +a.out.toFixed(2)}`); continue; }
    let j = i;
    while (j + 1 < list.length && list[j + 1].out >= 1 && list[j + 1].day === nextWeekday(list[j].day)) j++;
    out.push(i === j ? fmtShort(a.day) : fmtRange(a.day, list[j].day));
    i = j;
  }
  return out;
}
