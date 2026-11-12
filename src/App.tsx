import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { TOAST_EVENT } from './approve.ts';
import { FilterBar } from './components/FilterBar.tsx';
import { SummaryCards } from './components/SummaryCards.tsx';
import { fmtAgo, fmtRange } from './format.ts';
import { applyFilters, getState, readHash, setState, useUi, type View } from './state/filters.ts';
import type { CalendarData, CapacityPeriod, Dashboard, LeaveRecord, Lookups, SavedView, Status, Summary } from './types.ts';
import { CalendarView } from './views/Calendar.tsx';
import { DashboardView } from './views/Dashboard.tsx';
import { LongLeaveView } from './views/LongLeave.tsx';
import { CapacityView } from './views/Capacity.tsx';
import { ListView } from './views/List.tsx';
import { ResourcesPanel } from './views/Resources.tsx';
import { SettingsSheet } from './views/Settings.tsx';
import { SetupView } from './views/Setup.tsx';

const VIEWS: { id: View; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' }, { id: 'longleave', label: 'Long leave' }, { id: 'calendar', label: 'Calendar' }, { id: 'list', label: 'List' }, { id: 'capacity', label: 'Capacity' },
];

export default function App() {
  const ui = useUi();
  const [status, setStatus] = useState<Status | null>(null);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cal, setCal] = useState<CalendarData | null>(null);
  const [rows, setRows] = useState<LeaveRecord[] | null>(null);
  const [cap, setCap] = useState<CapacityPeriod[] | null>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [sideCollapsed, setSideCollapsed] = useState(() => {
    try { return localStorage.getItem('sideCollapsed') === '1'; } catch { return false; }
  });
  const toggleSide = useCallback(() => setSideCollapsed((c) => {
    try { localStorage.setItem('sideCollapsed', c ? '0' : '1'); } catch { /* private mode */ }
    return !c;
  }), []);
  const [sheet, setSheet] = useState<'' | 'settings' | 'resources'>('');
  const [toast, setToast] = useState<{ text: string; path?: string } | null>(null);
  const [, tick] = useState(0);
  const [dataVersion, setDataVersion] = useState(0);
  const hashRead = useRef(false);
  const seq = useRef(0);
  const wasSyncing = useRef(false);

  const refreshStatus = useCallback(async () => {
    const s = await api.getStatus();
    // a sync just finished: everything on screen may have changed
    if (wasSyncing.current && !s.syncing) setDataVersion((v) => v + 1);
    wasSyncing.current = s.syncing;
    setStatus(s);
    return s;
  }, []);

  const refreshLookups = useCallback(async () => {
    const [l, v] = await Promise.all([api.getLookups(), api.listViews()]);
    setLookups(l);
    setViews(v);
    if (!hashRead.current) {
      hashRead.current = true;
      if (!readHash(l.today, l.sprints)) applyFilters({}, l.today, l.sprints);
    }
  }, []);

  // boot + backend pushes
  useEffect(() => {
    void refreshStatus().then((s) => { if (s.configured) void refreshLookups(); });
    const offs = [
      tiny.api.on('status-changed', () => { void refreshStatus(); }),
      tiny.api.on('data-changed', () => setDataVersion((v) => v + 1)),
      tiny.api.on('views-changed', () => { void api.listViews().then(setViews); }),
    ];
    const t = setInterval(() => tick((n) => n + 1), 30_000); // keeps "synced N min ago" honest
    return () => { offs.forEach((o) => o()); clearInterval(t); };
  }, [refreshStatus, refreshLookups]);

  useEffect(() => {
    if (status?.configured && dataVersion) void refreshLookups();
  }, [dataVersion, status?.configured, refreshLookups]);

  // data for the current view
  useEffect(() => {
    if (!status?.configured || !lookups) return;
    const n = ++seq.current;
    const f = ui.filters;
    const ok = () => n === seq.current;
    if (ui.view === 'dashboard') { void api.getDashboard(f).then((d) => ok() && setDash(d)); return; }
    if (ui.view === 'longleave') return; // the view fetches its own year
    void api.getSummary(f).then((s) => ok() && setSummary(s));
    if (ui.view === 'calendar') void api.getCalendar(f).then((d) => ok() && setCal(d));
    if (ui.view === 'list') void api.getLeave(f, ui.sort).then((d) => ok() && setRows(d));
    if (ui.view === 'capacity') {
      void api.getCapacity(f, f.preset.startsWith('sprint:') ? f.preset.slice(7) : null).then((d) => ok() && setCap(d));
    }
  }, [ui.filters, ui.view, ui.sort, status?.configured, lookups, dataVersion]);

  // ---- actions ------------------------------------------------------------------
  const syncNow = useCallback(async () => {
    try { await api.syncNow(); } finally { await refreshStatus(); setDataVersion((v) => v + 1); }
  }, [refreshStatus]);

  const doExport = useCallback(async (kind: 'csv' | 'xlsx') => {
    const { filters, sort } = getState();
    const path = await tiny.dialog.saveFile({ types: [kind], name: `leave-${filters.from}-to-${filters.to}` });
    if (!path) return;
    try {
      const r = kind === 'csv' ? await api.exportCsv(filters, sort, path) : await api.exportXlsx(filters, sort, path);
      setToast({ text: `Exported ${r.rows} row${r.rows === 1 ? '' : 's'}`, path: r.path });
    } catch (e: any) { setToast({ text: 'Export failed: ' + String(e?.message ?? e) }); }
  }, []);

  const saveView = useCallback(async () => {
    const name = await tiny.dialog.prompt('Save the current filters as a view', { default: '', ok: 'Save', cancel: 'Cancel' });
    if (!name?.trim()) return;
    setViews(await api.saveView(name.trim(), getState().filters));
    setToast({ text: `Saved view “${name.trim()}”` });
  }, []);

  const deleteView = useCallback(async (name: string) => {
    if (await tiny.dialog.confirm(`Delete the saved view “${name}”?`, { ok: 'Delete', cancel: 'Cancel' })) setViews(await api.deleteView(name));
  }, []);

  const openView = useCallback((name: string) => {
    const v = views.find((x) => x.name === name);
    if (v && lookups) applyFilters(v.filters, lookups.today, lookups.sprints);
  }, [views, lookups]);

  // ---- native menu ---------------------------------------------------------------
  useEffect(() => {
    const configured = !!status?.configured;
    tiny.menu.set([
      { role: 'app', items: [{ id: 'settings', label: 'Settings…', key: ',', enabled: configured }] },
      { title: 'File', items: [
        { id: 'sync', label: 'Sync Now', key: 'r', enabled: configured },
        { separator: true },
        { id: 'export-csv', label: 'Export CSV…', key: 'e', enabled: configured },
        { id: 'export-xlsx', label: 'Export Excel…', key: 'E', enabled: configured },
      ] },
      { role: 'edit' },
      { title: 'View', items: [
        { id: 'view:dashboard', label: 'Dashboard', key: '0', enabled: configured },
        { id: 'view:longleave', label: 'Long Leave', key: '9', enabled: configured },
        { id: 'view:calendar', label: 'Calendar', key: '1', enabled: configured },
        { id: 'view:list', label: 'List', key: '2', enabled: configured },
        { id: 'view:capacity', label: 'Capacity', key: '3', enabled: configured },
        { separator: true },
        { id: 'toggle-filters', label: 'Toggle Filters', key: 'b', enabled: configured },
        { id: 'resources', label: 'Resources', key: 'R' },
      ] },
      { title: 'Saved Views', items: [
        { id: 'save-view', label: 'Save Current View…', key: 's', enabled: configured },
        ...(views.length ? [{ separator: true }, ...views.map((v) => ({ id: 'saved:' + v.name, label: v.name, enabled: configured }))] : []),
      ] },
    ]);
  }, [views, status?.configured]);

  useEffect(() => {
    const off = tiny.menu.on((id: string) => {
      if (id === 'sync') void syncNow();
      else if (id === 'export-csv') void doExport('csv');
      else if (id === 'export-xlsx') void doExport('xlsx');
      else if (id === 'settings') setSheet('settings');
      else if (id === 'resources') setSheet((s) => (s === 'resources' ? '' : 'resources'));
      else if (id === 'save-view') void saveView();
      else if (id === 'toggle-filters') toggleSide();
      else if (id.startsWith('view:')) setState({ view: id.slice(5) as View });
      else if (id.startsWith('saved:')) openView(id.slice(6));
    });
    return () => { if (typeof off === 'function') off(); };
  }, [syncNow, doExport, saveView, openView, toggleSide]);

  useEffect(() => {
    const on = (e: Event) => setToast({ text: String((e as CustomEvent).detail) });
    window.addEventListener(TOAST_EVENT, on);
    return () => window.removeEventListener(TOAST_EVENT, on);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- render --------------------------------------------------------------------
  if (!status) return <div className="empty">Starting…</div>;
  if (!status.configured) {
    return (
      <>
        <SetupView onDone={async () => { hashRead.current = false; await refreshStatus(); await refreshLookups(); }} />
        {sheet === 'resources' && <ResourcesPanel onClose={() => setSheet('')} />}
      </>
    );
  }

  const f = ui.filters;
  return (
    <div className="app">
      <header className="top">
        <div className="brand">Leave Radar{status.demo && <span className="tag demo">demo data</span>}</div>
        <nav className="seg">
          {VIEWS.map((v) => (
            <button type="button" key={v.id} className={'chip' + (ui.view === v.id ? ' on' : '')} onClick={() => setState({ view: v.id })}>{v.label}</button>
          ))}
        </nav>
        <div className="spacer" />
        <span className={'sync-state small' + (status.lastError ? ' warn-text' : ' muted')} title={status.lastAttemptAt ? `last attempt ${fmtAgo(status.lastAttemptAt)}` : ''}>
          {status.syncing ? 'Syncing…' : `Synced ${fmtAgo(status.lastSyncAt)}`}
        </span>
        <button type="button" onClick={syncNow} disabled={status.syncing} title="Sync now (⌘R)">⟳ Sync</button>
        <button type="button" onClick={() => doExport('csv')} title="Export CSV (⌘E) · Excel: ⌘⇧E">Export</button>
        <button type="button" onClick={() => setSheet('settings')} title="Settings (⌘,)">Settings</button>
        <button type="button" className={'icon-btn' + (sideCollapsed ? '' : ' on')} onClick={toggleSide}
          title={(sideCollapsed ? 'Show' : 'Hide') + ' filters (⌘B)'} aria-label="Toggle filters">⫶ Filters</button>
      </header>

      {status.lastError && (
        <div className="banner">
          Sync failed: {status.lastError}. Showing cached data from {status.lastSyncAt ? `the last good sync, ${fmtAgo(status.lastSyncAt)}` : 'no successful sync yet'}.
          <button type="button" className="link" onClick={syncNow}>Retry</button>
        </div>
      )}

      <div className="body">
        <div className="content">
          {ui.view !== 'dashboard' && ui.view !== 'longleave' && <SummaryCards s={summary} range={fmtRange(f.from, f.to)} />}
          <main className="main">
            {ui.view === 'dashboard' && <DashboardView data={dash} typeOrder={lookups?.types.map((t) => t.name) ?? []}
              onRefresh={syncNow} syncing={status.syncing} lastSyncAt={status.lastSyncAt}
              filters={f} version={dataVersion} />}
            {ui.view === 'longleave' && (
              <LongLeaveView filters={f} version={dataVersion} onRefresh={syncNow} syncing={status.syncing} lastSyncAt={status.lastSyncAt} />
            )}
            {ui.view === 'calendar' && <CalendarView data={cal} today={lookups?.today ?? ''} />}
            {ui.view === 'list' && <ListView rows={rows} />}
            {ui.view === 'capacity' && <CapacityView periods={cap} />}
          </main>
        </div>
        {lookups && (
          <FilterBar lookups={lookups} views={views} onSaveView={saveView} onDeleteView={deleteView}
            dashboard={ui.view === 'dashboard' || ui.view === 'longleave'} collapsed={sideCollapsed} onToggle={toggleSide} />
        )}
      </div>

      {toast && (
        <div className="toast">
          {toast.text}
          {toast.path && <button type="button" className="link" onClick={() => tiny.app.shell.reveal(toast.path!)}>Show in Finder</button>}
        </div>
      )}
      {sheet === 'settings' && (
        <SettingsSheet onClose={() => setSheet('')} onSignedOut={async () => { setSheet(''); setLookups(null); await refreshStatus(); }} />
      )}
      {sheet === 'resources' && <ResourcesPanel onClose={() => setSheet('')} />}
    </div>
  );
}
