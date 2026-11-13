// First run: company domain + personal API key -> Keychain. The key goes
// straight to the backend, which test-calls BambooHR before storing it.
import { useState } from 'react';
import { api } from '../api.ts';
import { ColorPicker } from '../components/TeamColor.tsx';
import { TEAM_COLORS } from '../teamColors.ts';

/** first run (or a team without a key yet), or — with onCancel — adding a team */
export function SetupView({ onDone, onCancel, teamName = '', teamColor, usedColors = [] }: { onDone: () => void; onCancel?: () => void; teamName?: string; teamColor?: string; usedColors?: string[] }) {
  const adding = !!onCancel;
  const [name, setName] = useState(adding ? '' : teamName === 'My team' ? '' : teamName);
  const [color, setColor] = useState(() => teamColor ?? TEAM_COLORS.find((c) => !usedColors.includes(c)) ?? TEAM_COLORS[0]);
  const [domain, setDomain] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'' | 'key' | 'demo'>('');
  const [err, setErr] = useState('');

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('key'); setErr('');
    try {
      if (adding) await api.addTeam({ name, companyDomain: domain, apiKey: key, color });
      else await api.setup(domain, key, name || undefined, color);
      setKey(''); onDone();
    }
    catch (x: any) { setErr(String(x?.message ?? x)); }
    finally { setBusy(''); }
  };
  const demo = async () => {
    setBusy('demo'); setErr('');
    try {
      if (adding) await api.addTeam({ name: name || 'Demo team', demo: true, color });
      else await api.setupDemo(name || undefined, color);
      onDone();
    } catch (x: any) { setErr(String(x?.message ?? x)); } finally { setBusy(''); }
  };

  return (
    <div className={adding ? 'sheet-backdrop setup-overlay' : 'setup'} onMouseDown={(e) => adding && e.target === e.currentTarget && onCancel!()}>
      <form className="setup-card" onSubmit={connect}>
        <h1>{adding ? 'Add a team' : 'Leave Radar'}</h1>
        <p className="muted">{adding
          ? 'Each team uses its own BambooHR API key — the key owner’s reporting line is the team. Switch teams from the top bar.'
          : 'Every Draft and Planned leave request in your reporting line, from BambooHR.'}</p>
        <label>Team name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SOC, Data Platform" autoFocus={adding} required={adding} maxLength={60} />
        </label>
        <div className="setup-color">
          <span className="setup-color-l">Team colour <span className="team-tag" style={{ '--tc': color } as React.CSSProperties}><i />{name.trim() || 'Team'}</span></span>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <label>Company domain
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme  (from acme.bamboohr.com)" autoFocus={!adding} required />
        </label>
        <label>{adding ? 'BambooHR API key for this team' : 'Personal BambooHR API key'}
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="BambooHR → your avatar → API Keys" required autoComplete="off" />
        </label>
        <p className="small muted">The key carries your own BambooHR permissions, so the app sees exactly what you can see. It is stored in the macOS Keychain only — never in files, logs or the cache.</p>
        {err && <div className="error">{err}</div>}
        <div className="row">
          <button type="submit" className="primary" disabled={!!busy}>{busy === 'key' ? 'Checking…' : adding ? 'Add team' : 'Connect'}</button>
          {adding && <button type="button" onClick={onCancel} disabled={!!busy}>Cancel</button>}
          <div className="spacer" />
          <button type="button" className="link" onClick={demo} disabled={!!busy}>{busy === 'demo' ? 'Loading…' : 'Try with demo data'}</button>
        </div>
      </form>
    </div>
  );
}
