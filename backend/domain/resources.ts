// Resource panel sampling: the app's own processes on this Mac.
//
// - backend (txiki.js): its own pid, tjs.pid
// - native window process: a child of the backend (or, in a bundle, possibly
//   its .app parent) — never the shell or the tinyjs CLI that ran `dev`
// - WebKit helpers (WebContent / Networking / GPU) are XPC services started
//   by launchd (ppid 1), so the parent chain can't find them.
//   `launchctl print pid/<window pid>` lists the XPC services in that
//   process's launchd domain WITH their pids — exact attribution (verified on
//   macOS 26, tinyjs 0.57). Fallback if that ever stops working: WebKit
//   helpers started within 20 s after the window process — flagged as a
//   heuristic in the panel.
//
// Samples every 2 s ONLY while the panel is open; the last 150 samples stay
// in memory for the trend line, nothing is written to disk.

export interface ProcRow { pid: number; ppid: number; rssKb: number; cpu: number; etimeS: number; comm: string }
export interface ProcSample { name: string; pid: number; role: string; rssMb: number; cpuPct: number; uptimeS: number }

const dec = new TextDecoder();

async function run(args: string[]): Promise<string> {
  const proc = tjs.spawn(args, { stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' });
  let out = '';
  const reader = proc.stdout.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      out += dec.decode(value, { stream: true });
    }
  } catch { /* closes with the process */ }
  await proc.wait();
  return out;
}

/** ps etime: [[dd-]hh:]mm:ss */
export function parseEtime(s: string): number {
  const [dPart, rest] = s.includes('-') ? s.split('-') : ['0', s];
  const parts = rest.split(':').map(Number).reverse();
  return Number(dPart) * 86400 + (parts[0] || 0) + (parts[1] || 0) * 60 + (parts[2] || 0) * 3600;
}

export function parsePs(text: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.+)$/);
    if (!m) continue;
    rows.push({ pid: +m[1], ppid: +m[2], rssKb: +m[3], cpu: +m[4], etimeS: parseEtime(m[5]), comm: m[6] });
  }
  return rows;
}

const base = (comm: string) => comm.split('/').pop() || comm;
const NOT_APP = /^(-?zsh|-?bash|sh|fish|login|launchd|node|npm|tinyjs|Terminal|Code Helper.*|Electron|esbuild|vite)$/i;

function roleOf(comm: string, pid: number, ownPid: number): string {
  if (pid === ownPid) return 'Backend (txiki.js)';
  const b = base(comm);
  if (b.includes('WebKit.WebContent')) return 'Web content (UI)';
  if (b.includes('WebKit.Networking')) return 'WebKit networking';
  if (b.includes('WebKit.GPU')) return 'WebKit GPU';
  return 'App window (native)';
}

/** pids of running WebKit services in `launchctl print pid/N` output; lines
 *  look like "\t   17864      - \tcom.apple.WebKit.Networking.<uuid>" */
export function parseLaunchctl(text: string): Set<number> {
  const out = new Set<number>();
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+\S+\s+(com\.apple\.WebKit\.\S+)/);
    if (m && +m[1] > 0) out.add(+m[1]);
  }
  return out;
}

async function launchdServices(appPid: number): Promise<Set<number>> {
  try { return parseLaunchctl(await run(['/bin/launchctl', 'print', `pid/${appPid}`])); }
  catch { return new Set(); }
}

let cachedHelpers: { appPid: number; pids: Set<number>; method: string } | null = null;

export async function sampleProcesses(): Promise<{ processes: ProcSample[]; attribution: string }> {
  const ownPid: number = tjs.pid;
  const rows = parsePs(await run(['/bin/ps', '-axo', 'pid=,ppid=,rss=,%cpu=,etime=,comm=']));
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const kids = new Map<number, ProcRow[]>();
  for (const r of rows) { const l = kids.get(r.ppid); if (l) l.push(r); else kids.set(r.ppid, [r]); }

  // The backend and everything it started (the native window process is its
  // child — measured on tinyjs 0.57 / macOS 26), minus our own ps/launchctl.
  // Its parent joins only when it is the .app launcher itself; in dev the
  // parent is the tinyjs CLI, which is tooling, not the app.
  const family = new Map<number, ProcRow>();
  const walk = (r: ProcRow) => {
    if (r.pid !== ownPid && /(^|\/)(ps|launchctl)$/.test(r.comm)) return;
    family.set(r.pid, r);
    for (const k of kids.get(r.pid) ?? []) walk(k);
  };
  const self = byPid.get(ownPid);
  if (self) {
    walk(self);
    const parent = byPid.get(self.ppid);
    if (parent && parent.pid > 1 && /\.app\/Contents\/MacOS\//.test(parent.comm) && !NOT_APP.test(base(parent.comm))) {
      family.set(parent.pid, parent);
    }
  }
  // candidates for "the window process": non-backend members, .app binary first
  const candidates = [...family.values()]
    .filter((r) => r.pid !== ownPid)
    .sort((a, b) => Number(/\.app\/Contents\/MacOS\//.test(b.comm)) - Number(/\.app\/Contents\/MacOS\//.test(a.comm)));
  const appProc = candidates[0] ?? self;

  // WebKit helpers
  let attribution = 'parent chain only';
  if (appProc) {
    if (!cachedHelpers || !family.has(cachedHelpers.appPid) || [...cachedHelpers.pids].some((p) => !byPid.has(p))) {
      let viaLaunchd = new Set<number>(), owner = appProc.pid;
      for (const c of candidates.slice(0, 3)) {
        viaLaunchd = await launchdServices(c.pid);
        if (viaLaunchd.size) { owner = c.pid; break; }
      }
      if (viaLaunchd.size) cachedHelpers = { appPid: owner, pids: viaLaunchd, method: 'launchd domain of the window process' };
      else {
        // heuristic: WebKit helpers that started 0–20 s after the app process
        const pids = new Set(rows.filter((r) => /com\.apple\.WebKit\./.test(r.comm) && r.ppid === 1
          && r.etimeS <= appProc.etimeS && appProc.etimeS - r.etimeS <= 20).map((r) => r.pid));
        cachedHelpers = { appPid: appProc.pid, pids, method: 'start-time heuristic (verify)' };
      }
    }
    for (const pid of cachedHelpers.pids) { const r = byPid.get(pid); if (r) family.set(pid, r); }
    attribution = cachedHelpers.method;
  }

  const processes = [...family.values()]
    .map((r) => ({
      name: base(r.comm), pid: r.pid, role: roleOf(r.comm, r.pid, ownPid),
      rssMb: Math.round(r.rssKb / 102.4) / 10, cpuPct: r.cpu, uptimeS: r.etimeS,
    }))
    .sort((a, b) => b.rssMb - a.rssMb);
  return { processes, attribution };
}

// ---- sampler loop ---------------------------------------------------------

export interface ResourceSnapshot {
  at: number;
  processes: ProcSample[];
  totals: { rssMb: number; cpuPct: number; count: number };
  attribution: string;
}

const MAX_SAMPLES = 150; // 5 minutes at 2 s
const history: { at: number; rssMb: number; cpuPct: number }[] = [];
let timer: any = null;
let latest: ResourceSnapshot | null = null;
let openCount = 0;

export function resourceHistory() { return history.slice(); }
export function latestSnapshot() { return latest; }

async function tick(onSample: (s: ResourceSnapshot) => void) {
  try {
    const { processes, attribution } = await sampleProcesses();
    const totals = {
      rssMb: Math.round(processes.reduce((a, p) => a + p.rssMb, 0) * 10) / 10,
      cpuPct: Math.round(processes.reduce((a, p) => a + p.cpuPct, 0) * 10) / 10,
      count: processes.length,
    };
    latest = { at: Date.now(), processes, totals, attribution };
    history.push({ at: latest.at, rssMb: totals.rssMb, cpuPct: totals.cpuPct });
    if (history.length > MAX_SAMPLES) history.splice(0, history.length - MAX_SAMPLES);
    onSample(latest);
  } catch { /* ps failed: skip this tick */ }
}

/** panel opened (ref-counted: more than one window may show it) */
export function startSampling(onSample: (s: ResourceSnapshot) => void) {
  openCount++;
  if (timer) return;
  void tick(onSample);
  timer = setInterval(() => void tick(onSample), 2000);
}
export function stopSampling(force = false) {
  openCount = force ? 0 : Math.max(0, openCount - 1);
  if (openCount === 0 && timer) { clearInterval(timer); timer = null; }
}
