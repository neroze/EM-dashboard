// Settings sheet: squads (person -> squad), overlap thresholds, deep link,
// weekly digest, sync log, sign out.
import { useEffect, useRef, useState } from 'react';
import { api, type Settings } from '../api.ts';
import { fmtAgo } from '../format.ts';
import { Select } from '../components/Select.tsx';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function SettingsSheet({ onClose, onSignedOut }: { onClose: () => void; onSignedOut: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [webhook, setWebhook] = useState('');
  const [newSquad, setNewSquad] = useState('');
  const [digest, setDigest] = useState<{ title: string; text: string } | null>(null);
  const [log, setLog] = useState<Awaited<ReturnType<typeof api.getSyncLog>>>([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    void api.getSettings().then((x) => { setS(x); setDraft(x); });
    void api.getSyncLog().then(setLog);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, []);

  if (!s || !draft) return null;
  const upd = (patch: Partial<Settings>) => setDraft({ ...draft, ...patch });

  const save = async () => {
    setErr(''); setMsg('');
    try {
      const next = await api.saveSettings({
        defaultThreshold: draft.defaultThreshold, thresholds: draft.thresholds, linkTemplate: draft.linkTemplate,
        hoursPerDay: draft.hoursPerDay, squads: draft.squads, squadMap: draft.squadMap, digest: draft.digest,
        ...(webhook ? { slackWebhook: webhook } : {}),
      });
      setS(next); setDraft(next); setWebhook('');
      setMsg('Saved.' + (draft.hoursPerDay !== s.hoursPerDay ? ' Hours-per-day applies from the next sync.' : ''));
    } catch (x: any) { setErr(String(x?.message ?? x)); }
  };

  const signOut = async () => {
    const ok = await tiny.dialog.confirm('Sign out of Leave Radar?', {
      detail: 'Deletes the API key from the Keychain and the local leave cache. BambooHR is not affected.',
      ok: 'Sign Out', cancel: 'Cancel',
    });
    if (!ok) return;
    await api.signOut();
    onSignedOut();
  };

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet wide">
        <header className="sheet-head">
          <h2>Settings</h2>
          <div className="spacer" />
          {msg && <span className="ok-text small">{msg}</span>}
          {err && <span className="error small">{err}</span>}
          <button type="button" className="primary" onClick={save}>Save</button>
          <button type="button" onClick={onClose}>Close</button>
        </header>

        <section>
          <h3>Squads</h3>
          <p className="muted small">Person → squad mapping (stored locally in <code>config/squads.json</code>). Unmapped people show as “Unassigned”.</p>
          <div className="row wrap">
            {draft.squads.map((q) => (
              <span key={q} className="tag">{q}
                <button type="button" className="link" title="Remove squad"
                  onClick={() => upd({ squads: draft.squads.filter((x) => x !== q),
                    squadMap: Object.fromEntries(Object.entries(draft.squadMap).filter(([, t]) => t !== q)) })}>×</button>
              </span>
            ))}
            <input className="narrow-input" placeholder="New squad" value={newSquad} onChange={(e) => setNewSquad(e.target.value)} />
            <button type="button" disabled={!newSquad.trim() || draft.squads.includes(newSquad.trim())}
              onClick={() => { upd({ squads: [...draft.squads, newSquad.trim()] }); setNewSquad(''); }}>Add</button>
          </div>
          <div className="squad-grid">
            {draft.people.map((p) => (
              <div key={p.id} className="squad-row">
                <span>{p.name}</span>
                <Select value={draft.squadMap[p.id] ?? ''} minWidth={140} onChange={(v) => {
                  const m = { ...draft.squadMap };
                  if (v) m[p.id] = v; else delete m[p.id];
                  upd({ squadMap: m });
                }}
                  options={[{ value: '', label: 'Unassigned' }, ...draft.squads.map((q) => ({ value: q, label: q }))]} />
              </div>
            ))}
            {!draft.people.length && <div className="muted small">People appear here after the first sync.</div>}
          </div>
        </section>

        <section>
          <h3>Overlap alerts</h3>
          <div className="row wrap">
            <label>Default threshold
              <input type="number" min={5} max={100} step={5} className="num" value={Math.round(draft.defaultThreshold * 100)}
                onChange={(e) => upd({ defaultThreshold: Math.max(1, Math.min(100, +e.target.value)) / 100 })} /> % of squad out
            </label>
            {draft.squads.map((q) => (
              <label key={q}>{q}
                <input type="number" min={5} max={100} step={5} className="num" placeholder={String(Math.round(draft.defaultThreshold * 100))}
                  value={draft.thresholds[q] ? Math.round(draft.thresholds[q] * 100) : ''}
                  onChange={(e) => {
                    const t = { ...draft.thresholds };
                    if (e.target.value) t[q] = Math.max(1, Math.min(100, +e.target.value)) / 100; else delete t[q];
                    upd({ thresholds: t });
                  }} /> %
              </label>
            ))}
          </div>
        </section>

        <section>
          <h3>BambooHR</h3>
          <label className="block">Deep link template <span className="muted small">— {'{domain}'}, {'{employeeId}'}, {'{requestId}'} (verify the path in your tenant)</span>
            <input value={draft.linkTemplate} onChange={(e) => upd({ linkTemplate: e.target.value })} />
          </label>
          <label>Hours per working day (converts hour-based requests to days)
            <input type="number" min={1} max={24} className="num" value={draft.hoursPerDay} onChange={(e) => upd({ hoursPerDay: +e.target.value })} />
          </label>
        </section>

        <section>
          <h3>Weekly digest</h3>
          <p className="muted small">Next two weeks of leave, drafts waiting and low-capacity days — posted to Slack via an incoming webhook (kept in the Keychain), or opened as an email draft.</p>
          <div className="row wrap">
            <input className="grow" type="password" placeholder={s.hasSlackWebhook ? 'Slack webhook saved — paste to replace' : 'https://hooks.slack.com/services/…'}
              value={webhook} onChange={(e) => setWebhook(e.target.value)} autoComplete="off" />
            {s.hasSlackWebhook && <button type="button" className="link" onClick={async () => {
              const next = await api.saveSettings({ slackWebhook: '' }); setS(next); setDraft({ ...draft, hasSlackWebhook: false });
            }}>Remove webhook</button>}
          </div>
          <div className="row wrap">
            <label className="toggle"><input type="checkbox" checked={draft.digest.enabled} onChange={(e) => upd({ digest: { ...draft.digest, enabled: e.target.checked } })} /> Post to Slack every</label>
            <Select value={draft.digest.weekday} onChange={(weekday) => upd({ digest: { ...draft.digest, weekday } })}
              options={WEEKDAYS.map((w, i) => ({ value: i, label: w }))} />
            <span>after</span>
            <Select value={draft.digest.hour} onChange={(hour) => upd({ digest: { ...draft.digest, hour } })}
              options={Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, '0')}:00` }))} />
            <span className="muted small">(while the app is open){draft.digest.lastSent ? ` · last sent ${draft.digest.lastSent}` : ''}</span>
          </div>
          <div className="row wrap">
            <button type="button" onClick={async () => setDigest(await api.getDigest())}>Preview</button>
            <button type="button" disabled={!s.hasSlackWebhook} onClick={async () => {
              setErr(''); setMsg('');
              try { await api.sendDigest(); setMsg('Digest posted to Slack.'); } catch (x: any) { setErr(String(x?.message ?? x)); }
            }}>Send to Slack now</button>
            <button type="button" onClick={async () => {
              const d = digest ?? await api.getDigest();
              await tiny.app.shell.open(`mailto:?subject=${encodeURIComponent(d.title)}&body=${encodeURIComponent(d.text)}`);
            }}>Open as email…</button>
            {digest && <button type="button" onClick={() => { tiny.clipboard.write({ text: digest.text }); setMsg('Copied.'); }}>Copy</button>}
          </div>
          {digest && <pre className="digest">{digest.text}</pre>}
        </section>

        <section>
          <h3>Sync log</h3>
          <table className="list compact">
            <thead><tr><th>When</th><th>Result</th><th className="num">Records</th><th className="num">Duration</th></tr></thead>
            <tbody>
              {log.map((l) => (
                <tr key={l.at}><td>{fmtAgo(l.at)}</td><td>{l.ok ? <span className="ok-text">OK</span> : <span className="error">{l.error}</span>}</td>
                  <td className="num">{l.records}</td><td className="num">{(l.durationMs / 1000).toFixed(1)} s</td></tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h3>Sign out</h3>
          <p className="muted small">Removes the API key from the Keychain and deletes the local cache (leave, people, saved views).</p>
          <button type="button" className="danger" onClick={signOut}>Sign out…</button>
        </section>
      </div>
    </div>
  );
}
