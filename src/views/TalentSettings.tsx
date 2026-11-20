// Talent Grid settings (FR-29): Grid, Weights, Export, Import tabs.
// Appearance (FR-30) is the app-wide Light / Dark / System button in the header.
import { useEffect, useRef, useState } from 'react';
import { api, type TalentState } from '../api.ts';
import {
  axisCriteria, CRITERIA, equalWeights, LEVELS, place, weightsError, type Axis, type Layout, type Level, type Weights,
} from '../../backend/domain/talent.ts';

type Tab = 'grid' | 'weights' | 'export' | 'import';
const TABS: { id: Tab; label: string }[] = [{ id: 'grid', label: 'Grid' }, { id: 'weights', label: 'Weights' }, { id: 'export', label: 'Export' }, { id: 'import', label: 'Import' }];
const errText = (e: unknown) => String((e as any)?.message ?? e).replace(/^Error:\s*/, '');

/** a small picture of a layout for the Grid tab */
function LayoutPreview({ n }: { n: Layout }) {
  return (
    <span className={`tg-mini g${n}`} aria-hidden="true">
      {Array.from({ length: n * n }, (_, i) => <span key={i} />)}
    </span>
  );
}

export function TalentSettings({ data, layout, initialTab = 'grid', onLayout, density, onDensity, onClose, onChanged, toast }: {
  data: TalentState; layout: Layout; initialTab?: Tab;
  density: 'compact' | 'comfort'; onDensity: (d: 'compact' | 'comfort') => void;
  onLayout: (l: Layout) => void; onClose: () => void;
  /** something was saved: reload the board */
  onChanged: () => Promise<void>;
  toast: (text: string) => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, []);

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet wide tg-sheet" role="dialog" aria-modal="true" aria-labelledby="tg-set-title">
        <header className="sheet-head">
          <h2 id="tg-set-title">Talent Grid settings</h2>
          <div className="spacer" />
          <button type="button" onClick={onClose}>Close</button>
        </header>
        <div className="seg tg-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={'chip' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <div role="tabpanel">
          {tab === 'grid' && (
            <section>
              <h3>Grid size</h3>
              <p className="muted small">Switching never changes ratings: everyone is re-placed with that layout’s bands.</p>
              <div className="tg-layout-pick">
                {([3, 4] as Layout[]).map((n) => (
                  <button key={n} type="button" className={'tg-layout-opt' + (layout === n ? ' on' : '')} aria-pressed={layout === n} onClick={() => onLayout(n)}>
                    <LayoutPreview n={n} />
                    <b>{n}×{n}{n === 3 ? ' (default)' : ''}</b>
                    <span className="small muted">{n === 3 ? 'High · Medium · Low on each axis, 9 boxes' : 'Exceptional · High · Moderate · Low, 16 boxes'}</span>
                  </button>
                ))}
              </div>
              <h3 style={{ marginTop: 18 }}>Density</h3>
              <p className="muted small">Comfort gives bigger boxes, larger text and more spacing, and shows each box’s description on the grid. Remembered on this computer.</p>
              <div className="seg" role="group" aria-label="Density">
                {(['compact', 'comfort'] as const).map((d) => (
                  <button key={d} type="button" className={'chip' + (density === d ? ' on' : '')} aria-pressed={density === d} onClick={() => onDensity(d)}>
                    {d === 'compact' ? 'Compact' : 'Comfort'}</button>
                ))}
              </div>
            </section>
          )}
          {tab === 'weights' && <WeightsTab data={data} layout={layout} onChanged={onChanged} toast={toast} />}
          {tab === 'export' && <ExportTab count={data.employees.length} toast={toast} />}
          {tab === 'import' && <ImportTab onChanged={onChanged} toast={toast} />}
        </div>
      </div>
    </div>
  );
}

function WeightsTab({ data, layout, onChanged, toast }: { data: TalentState; layout: Layout; onChanged: () => Promise<void>; toast: (t: string) => void }) {
  const [drafts, setDrafts] = useState<Record<Level, Record<string, string>>>(() =>
    Object.fromEntries(LEVELS.map((l) => [l.id, Object.fromEntries(CRITERIA.map((c) => [c.id, String(data.weights[l.id][c.id])]))])) as any);
  const [msg, setMsg] = useState<Record<string, string>>({});

  return (
    <section>
      <h3>Criterion weights per job level</h3>
      <p className="muted small">The 5 weights on each axis must total 100%. Changing them re-places everyone at that level; each history entry keeps the weights in force at the time.</p>
      {LEVELS.map((l) => (
        <LevelWeights key={l.id} level={l.id} label={l.label} data={data} layout={layout}
          draft={drafts[l.id]} setDraft={(d) => setDrafts((x) => ({ ...x, [l.id]: d }))}
          msg={msg[l.id] ?? ''} setMsg={(m) => setMsg((x) => ({ ...x, [l.id]: m }))}
          onChanged={onChanged} toast={toast} />
      ))}
    </section>
  );
}

function LevelWeights({ level, label, data, layout, draft, setDraft, msg, setMsg, onChanged, toast }: {
  level: Level; label: string; data: TalentState; layout: Layout;
  draft: Record<string, string>; setDraft: (d: Record<string, string>) => void;
  msg: string; setMsg: (m: string) => void; onChanged: () => Promise<void>; toast: (t: string) => void;
}) {
  const parsed = Object.fromEntries(CRITERIA.map((c) => [c.id, draft[c.id].trim() === '' ? NaN : Number(draft[c.id])])) as unknown as Weights;
  const err = weightsError(parsed);
  const saved = data.weights[level];
  const dirty = CRITERIA.some((c) => parsed[c.id] !== saved[c.id]);
  const people = data.employees.filter((e) => e.level === level);
  const moving = err ? 0 : people.filter((e) => place(e.ratings, saved, layout).box !== place(e.ratings, parsed, layout).box).length;
  const sum = (axis: Axis) => axisCriteria(axis).reduce((s, c) => s + (Number.isFinite(parsed[c.id]) ? parsed[c.id] : 0), 0);

  const apply = async (w: Weights) => {
    const n = people.filter((e) => place(e.ratings, saved, layout).box !== place(e.ratings, w, layout).box).length;
    const ok = await tiny.dialog.confirm(`Save weights for ${label}?`, {
      detail: `${n} of ${people.length} ${people.length === 1 ? 'person' : 'people'} at this level will change box in the ${layout}×${layout} grid. Ratings are not changed.`,
      ok: 'Save weights', cancel: 'Cancel',
    });
    if (!ok) return;
    try {
      const r = await api.setTalentWeights(level, w);
      setDraft(Object.fromEntries(CRITERIA.map((c) => [c.id, String(w[c.id])])));
      setMsg('');
      await onChanged();
      toast(`${label} weights saved · ${r.changed} ${r.changed === 1 ? 'person' : 'people'} re-placed`);
    } catch (x) { setMsg(errText(x)); }
  };

  return (
    <div className="tg-weights">
      <h4>{label} <span className="muted">· {people.length} {people.length === 1 ? 'person' : 'people'}</span></h4>
      <div className="tg-weights-grid">
        {(['perf', 'pot'] as Axis[]).map((axis) => (
          <table key={axis} className="tg-wtable">
            <caption>{axis === 'perf' ? 'Performance' : 'Potential'} <span className={sum(axis) === 100 ? 'muted' : 'error'}>{sum(axis)}%</span></caption>
            <tbody>
              {axisCriteria(axis).map((c) => (
                <tr key={c.id}>
                  <th scope="row">{c.label}</th>
                  <td><input type="number" min={0} max={100} step={1} inputMode="numeric" aria-label={`${label}: ${c.label} weight, percent`}
                    value={draft[c.id]} onChange={(e) => setDraft({ ...draft, [c.id]: e.target.value })} />%</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
      <div className="tg-weights-act">
        {err ? <span className="error small">{err}</span>
          : dirty ? <span className="small">{moving} {moving === 1 ? 'person' : 'people'} would change box</span>
          : <span className="muted small">Saved</span>}
        {msg && <span className="error small">{msg}</span>}
        <div className="spacer" />
        <button type="button" onClick={() => apply(equalWeights())} disabled={!CRITERIA.some((c) => saved[c.id] !== 20)}>Reset to equal (20%)</button>
        <button type="button" className="primary" disabled={!!err || !dirty} onClick={() => apply(parsed)}>Save</button>
      </div>
    </div>
  );
}

function ExportTab({ count, toast }: { count: number; toast: (t: string) => void }) {
  const [err, setErr] = useState('');
  const run = async (kind: 'csv' | 'json') => {
    setErr('');
    const stamp = new Date().toISOString().slice(0, 10);
    const path = await tiny.dialog.saveFile({ types: [kind], name: kind === 'csv' ? `talent-grid-${stamp}` : `talent-grid-backup-${stamp}` });
    if (!path) return;
    try {
      if (kind === 'csv') await api.exportTalentCsv(path); else await api.exportTalentBackup(path);
      toast(kind === 'csv' ? `Exported ${count} ${count === 1 ? 'employee' : 'employees'} to CSV` : 'Backup saved');
    } catch (x) { setErr(errText(x)); }
  };
  return (
    <section>
      <p className="banner tg-banner" role="note">These files hold sensitive ratings and notes. Store them somewhere only you can open, and delete copies you no longer need.</p>
      <h3>Spreadsheet (CSV)</h3>
      <p className="muted small">One row per employee: name, role, level, both averages and bands, box and title in 3×3 and 4×4, and all 10 ratings. Opens in Excel, accents included.</p>
      <button type="button" onClick={() => run('csv')} disabled={!count}>Export CSV…</button>
      <h3 style={{ marginTop: 18 }}>Full backup</h3>
      <p className="muted small">Every employee with notes and full history, plus your weights. Import it back with nothing lost.</p>
      <button type="button" onClick={() => run('json')} disabled={!count}>Download backup…</button>
      {err && <p className="error small" role="alert">{err}</p>}
    </section>
  );
}

function ImportTab({ onChanged, toast }: { onChanged: () => Promise<void>; toast: (t: string) => void }) {
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [result, setResult] = useState('');
  const [err, setErr] = useState('');
  const run = async () => {
    setErr(''); setResult('');
    const path = await tiny.dialog.openFile({ types: ['json'] });
    if (!path) return;
    if (mode === 'replace' && !(await tiny.dialog.confirm('Replace your whole team with this backup?', {
      detail: 'Everyone currently on your grid, with their history, is removed and the backup’s team takes its place. This cannot be undone.', ok: 'Replace team', cancel: 'Cancel',
    }))) return;
    try {
      const r = await api.importTalentBackup(path, mode);
      await onChanged();
      const text = `Imported ${r.imported}, skipped ${r.skipped} invalid record${r.skipped === 1 ? '' : 's'}.`;
      setResult(text); toast(text);
    } catch (x) { setErr(errText(x)); }
  };
  return (
    <section>
      <h3>Import a backup</h3>
      <div className="tg-radio" role="radiogroup" aria-label="Import mode">
        <label><input type="radio" name="tg-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} /> <b>Merge</b> <span className="muted small">update matching people, add new ones</span></label>
        <label><input type="radio" name="tg-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} /> <b>Replace</b> <span className="muted small">swap the whole team for the backup’s</span></label>
      </div>
      <button type="button" onClick={run}>Choose backup file…</button>
      {result && <p className="ok-text small" role="status">{result}</p>}
      {err && <p className="error small" role="alert">{err}</p>}
    </section>
  );
}
