// First run: company domain + personal API key -> Keychain. The key goes
// straight to the backend, which test-calls BambooHR before storing it.
import { useState } from 'react';
import { api } from '../api.ts';

export function SetupView({ onDone }: { onDone: () => void }) {
  const [domain, setDomain] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'' | 'key' | 'demo'>('');
  const [err, setErr] = useState('');

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('key'); setErr('');
    try { await api.setup(domain, key); setKey(''); onDone(); }
    catch (x: any) { setErr(String(x?.message ?? x)); }
    finally { setBusy(''); }
  };
  const demo = async () => {
    setBusy('demo'); setErr('');
    try { await api.setupDemo(); onDone(); } catch (x: any) { setErr(String(x?.message ?? x)); } finally { setBusy(''); }
  };

  return (
    <div className="setup">
      <form className="setup-card" onSubmit={connect}>
        <h1>Leave Radar</h1>
        <p className="muted">Every Draft and Planned leave request in your reporting line, from BambooHR. Read-only — approvals stay in BambooHR.</p>
        <label>Company domain
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme  (from acme.bamboohr.com)" autoFocus required />
        </label>
        <label>Personal BambooHR API key
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="BambooHR → your avatar → API Keys" required autoComplete="off" />
        </label>
        <p className="small muted">The key carries your own BambooHR permissions, so the app sees exactly what you can see. It is stored in the macOS Keychain only — never in files, logs or the cache.</p>
        {err && <div className="error">{err}</div>}
        <div className="row">
          <button type="submit" className="primary" disabled={!!busy}>{busy === 'key' ? 'Checking…' : 'Connect'}</button>
          <div className="spacer" />
          <button type="button" className="link" onClick={demo} disabled={!!busy}>{busy === 'demo' ? 'Loading…' : 'Try with demo data'}</button>
        </div>
      </form>
    </div>
  );
}
