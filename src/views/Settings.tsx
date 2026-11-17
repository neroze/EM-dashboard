// Settings sheet: squads (person -> squad), overlap thresholds, deep link,
// weekly digest, sync log, sign out.
import { useEffect, useRef, useState } from 'react';
import { api, type JiraStatus, type Settings } from '../api.ts';
import { fmtAgo } from '../format.ts';
import { ColorPicker, TeamGroup, TeamTag } from '../components/TeamColor.tsx';
import { groupByTeam, useTeamOrder } from '../teamColors.ts';
import { Select } from '../components/Select.tsx';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function SettingsSheet({ onClose, onSignedOut, teams }: { onClose: () => void; onSignedOut: () => void; teams: { id: string; name: string; color: string }[] }) {
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(teams.map((t) => [t.id, t.name])));
  const [teamMsg, setTeamMsg] = useState('');
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

  const teamOrder = useTeamOrder();
  if (!s || !draft) return null;
  // every squad name once: the teams, then extra squads
  const allSquadNames = [...teams.map((t) => t.name), ...draft.squads.filter((q) => !teams.some((t) => t.name.toLowerCase() === q.toLowerCase()))];
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

  const removeTeam = async (team: { id: string; name: string }) => {
    const ok = await tiny.dialog.confirm(`Remove the team “${team.name}”?`, {
      detail: 'Deletes this team’s API key from the Keychain and its people and leave from the local cache. Other teams and BambooHR are not affected.'
        + (teams.length > 1 ? '' : '\n\nIt is your only team, so you will be back at the setup screen.'),
      ok: 'Remove Team', cancel: 'Cancel',
    });
    if (!ok) return;
    await api.removeTeam(team.id);
    onSignedOut();
  };
  const saveTeamName = async (team: { id: string; name: string }) => {
    try { await api.renameTeam(names[team.id] ?? '', team.id); setTeamMsg(`Renamed to ${names[team.id]?.trim()}.`); }
    catch (x: any) { setTeamMsg(String(x?.message ?? x).replace(/^Error:\s*/, '')); }
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
          <h3>Teams</h3>
          <p className="muted small">Each team has its own BambooHR API key (its owner’s reporting line). Choose which teams to view from the title at the top; you can also rename a team by clicking its name there. Other settings on this page apply to every team.</p>
          {teams.map((t) => (
            <div key={t.id} className="team-set-row">
              <input className="team-name-input" style={{ '--tc': t.color } as React.CSSProperties} value={names[t.id] ?? ''} maxLength={60} aria-label={`Name of ${t.name}`}
                onChange={(e) => { setNames((n) => ({ ...n, [t.id]: e.target.value })); setTeamMsg(''); }} />
              <button type="button" onClick={() => saveTeamName(t)} disabled={!names[t.id]?.trim() || names[t.id]?.trim() === t.name}>Rename</button>
              <button type="button" className="danger" onClick={() => removeTeam(t)}>Remove…</button>
              <ColorPicker value={t.color} onChange={(c) => void api.setTeamColor(t.id, c)} />
            </div>
          ))}
          {teamMsg && <div className="small muted">{teamMsg}</div>}
        </section>

        <section>
          <h3>Squad overrides</h3>
          <p className="muted small">Everyone’s squad is their team automatically (shown as <em>Auto</em>) — teams always come from team membership, so nobody shows under a team they aren’t in. Use an extra squad only to split a team further. Extra squads you add here are stored locally in <code>config/squads.json</code>.</p>
          <div className="row wrap">
            <span className="muted small">Extra squads:</span>
            {draft.squads.map((q) => (
              <span key={q} className="team-tag neutral">{q}
                <button type="button" className="link pill-x" title={`Remove squad “${q}”`} aria-label={`Remove squad ${q}`}
                  onClick={() => upd({ squads: draft.squads.filter((x) => x !== q),
                    squadMap: Object.fromEntries(Object.entries(draft.squadMap).filter(([, t]) => t !== q)) })}>×</button>
              </span>
            ))}
            {!draft.squads.length && <span className="muted small">none</span>}
            <input className="narrow-input" placeholder="New squad" value={newSquad} onChange={(e) => setNewSquad(e.target.value)} />
            <button type="button" disabled={!newSquad.trim() || allSquadNames.some((n) => n.toLowerCase() === newSquad.trim().toLowerCase())}
              title={allSquadNames.some((n) => n.toLowerCase() === newSquad.trim().toLowerCase()) ? 'That name is already a team or squad' : undefined}
              onClick={() => { upd({ squads: [...draft.squads, newSquad.trim()] }); setNewSquad(''); }}>Add</button>
          </div>
          {groupByTeam(draft.people, (p) => p.autoTeam ?? 'No team', teamOrder).map(([team, people]) => (
          <TeamGroup key={team} team={team} count={people.length} className="squad-team">
          <div className="squad-grid">
            {people.map((p) => (
              <div key={p.id} className="squad-row">
                <span className="squad-person">{p.name}</span>
                <Select value={draft.squadMap[p.id] ?? ''} minWidth={170}
                  display={draft.squadMap[p.id] ? <TeamTag name={draft.squadMap[p.id]} /> : <span className="squad-auto">Auto · <TeamTag name={p.autoTeam ?? 'No team'} /></span>}
                  onChange={(v) => {
                    const m = { ...draft.squadMap };
                    if (v && v !== p.autoTeam) m[p.id] = v; else delete m[p.id];
                    upd({ squadMap: m });
                  }}
                  options={[
                    { value: '', label: <span className="squad-auto">Auto · <TeamTag name={p.autoTeam ?? 'No team'} /></span> },
                    ...draft.squads.map((q) => ({ value: q, label: <TeamTag name={q} /> })),
                  ]} />
              </div>
            ))}
          </div>
          </TeamGroup>
          ))}
          {!draft.people.length && <div className="muted small">People appear here after the first sync.</div>}
        </section>

        <section>
          <h3>Overlap alerts</h3>
          <div className="row wrap">
            <label>Default threshold
              <input type="number" min={5} max={100} step={5} className="num" value={Math.round(draft.defaultThreshold * 100)}
                onChange={(e) => upd({ defaultThreshold: Math.max(1, Math.min(100, +e.target.value)) / 100 })} /> % of squad out
            </label>
            {allSquadNames.map((q) => (
              <label key={q}><TeamTag name={q} />
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

        <JiraSection />

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

      </div>
    </div>
  );
}

/** Jira for the Projects board: read-only; the token goes to the Keychain */
function JiraSection() {
  const [st, setSt] = useState<JiraStatus | null>(null);
  const [site, setSite] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { void api.getJiraStatus().then((x) => { setSt(x); setSite(x.site ?? ''); setEmail(x.email ?? ''); }); }, []);
  const connect = async () => {
    setBusy(true); setMsg('');
    try { const x = await api.setJira(site, email, token); setSt(x); setToken(''); setMsg('Connected.'); }
    catch (e: any) { setMsg(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };
  return (
    <section>
      <h3>Jira <span className="muted small">— for the Projects board: pulls each idea’s epics and their tickets, estimates, assignees and sprints (read-only)</span></h3>
      <div className="row wrap">
        <input placeholder="acme.atlassian.net" value={site} onChange={(e) => setSite(e.target.value)} />
        <input placeholder="Atlassian account email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        <input className="grow" type="password" placeholder={st?.configured ? 'API token saved — paste to replace' : 'API token (id.atlassian.com → Security)'}
          value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
        <button type="button" disabled={busy || !site || !email || !token} onClick={connect}>{busy ? 'Checking…' : 'Connect'}</button>
        {st?.configured && <button type="button" className="link" onClick={async () => { setSt(await api.clearJira()); setMsg('Disconnected.'); }}>Disconnect</button>}
      </div>
      <p className="muted small">{st?.configured ? `Connected to ${st.site}.` : 'Not connected.'} Estimates are read in 6-hour days. {msg}</p>
    </section>
  );
}
