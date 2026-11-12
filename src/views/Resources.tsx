// View → Resources (⌘⇧R): what the app itself uses on this Mac, refreshed
// every 2 s while open. Sampling stops when the panel closes.
import { useEffect, useState } from 'react';
import { api, type ResourceUsage } from '../api.ts';
import { fmtAgo, fmtUptime } from '../format.ts';
import type { ResourceSnapshot } from '../types.ts';

export function ResourcesPanel({ onClose }: { onClose: () => void }) {
  const [u, setU] = useState<ResourceUsage | null>(null);

  useEffect(() => {
    let live = true;
    const refresh = () => api.getResourceUsage().then((r) => live && setU(r)).catch(() => {});
    const off = tiny.api.on('resources', (_s: ResourceSnapshot) => { void refresh(); });
    void api.resourcesOpen().then(refresh);
    return () => { live = false; off(); void api.resourcesClose(); };
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet wide">
        <header className="sheet-head">
          <h2>Resources</h2>
          <span className="muted small">refreshes every 2 s while open</span>
          <div className="spacer" />
          <button type="button" onClick={onClose}>Close</button>
        </header>
        {!u ? <div className="empty">Sampling…</div> : (
          <>
            <div className="cards">
              <div className="card"><div className="card-n">{u.totals ? u.totals.rssMb.toFixed(0) : '–'}<small> MB</small></div><div className="card-l">memory, all app processes</div></div>
              <div className="card"><div className="card-n">{u.totals ? u.totals.cpuPct.toFixed(1) : '–'}<small> %</small></div><div className="card-l">CPU</div></div>
              <div className="card"><div className="card-n">{u.dbSizeMb.toFixed(2)}<small> MB</small></div><div className="card-l">SQLite · {u.records} requests · {u.leaveDays} leave days</div></div>
              <div className="card"><div className="card-n small-n">{u.lastSync ? fmtAgo(u.lastSync.at) : 'never'}</div>
                <div className="card-l">last sync{u.lastSync ? ` · ${(u.lastSync.durationMs / 1000).toFixed(1)} s · ${u.lastSync.records} records` : ''}</div></div>
            </div>
            <h4>Memory, last 5 minutes</h4>
            <Sparkline points={u.history.map((h) => h.rssMb)} />
            <table className="list">
              <thead><tr><th>Process</th><th>Role</th><th className="num">PID</th><th className="num">Memory</th><th className="num">CPU</th><th className="num">Uptime</th></tr></thead>
              <tbody>
                {u.processes.map((p) => (
                  <tr key={p.pid}>
                    <td className="mono">{p.name}</td><td>{p.role}</td><td className="num mono">{p.pid}</td>
                    <td className="num">{p.rssMb.toFixed(1)} MB</td><td className="num">{p.cpuPct.toFixed(1)} %</td><td className="num">{fmtUptime(p.uptimeS)}</td>
                  </tr>
                ))}
              </tbody>
              {u.totals && (
                <tfoot><tr><td>Total ({u.totals.count})</td><td /><td /><td className="num">{u.totals.rssMb.toFixed(1)} MB</td><td className="num">{u.totals.cpuPct.toFixed(1)} %</td><td /></tr></tfoot>
              )}
            </table>
            <p className="muted small">WebKit helpers attributed by: {u.attribution ?? '—'}. Memory is resident size (RSS) from <code>ps</code>.</p>
          </>
        )}
      </div>
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const W = 640, H = 70;
  if (points.length < 2) return <div className="spark muted small">collecting…</div>;
  const min = Math.min(...points), max = Math.max(...points);
  const span = Math.max(1, max - min);
  const step = W / 149; // 150 samples = 5 min at 2 s; newest at the right edge
  const x0 = W - (points.length - 1) * step;
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${(x0 + i * step).toFixed(1)},${(H - 6 - ((v - min) / span) * (H - 12)).toFixed(1)}`).join(' ');
  return (
    <div className="spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} role="img" aria-label="memory trend">
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="spark-lbl muted small"><span>{max.toFixed(0)} MB</span><span>{min.toFixed(0)} MB</span></div>
    </div>
  );
}
