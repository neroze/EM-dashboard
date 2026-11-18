// Jira Cloud REST client (read-only). Basic auth with account email + API
// token (id.atlassian.com → Security → API tokens). Never logs the token or
// response bodies — errors carry status + path only.
import { EPIC_FIELDS, mapEpic, mapTicket, TICKET_FIELDS, type Assignee } from './mappers.ts';
import type { ProjectEpic, Ticket } from '../domain/projectHealth.ts';
import { mapOutside, mapReleaseEpic, mapReleaseTask, OUTSIDE_FIELDS, RELEASE_EPIC_FIELDS, RELEASE_TASK_FIELDS } from './releaseMappers.ts';
import { RELEASE_EPIC_KEY, RELEASE_EPIC_LIMIT, RELEASE_TASK_LIMIT, type OutsideTicket, type ReleaseEpic, type ReleaseTask } from '../domain/release.ts';

export class JiraError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function b64(s: string) {
  let bin = '';
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function createJira(site: string, email: string, token: string, timeoutMs = 30_000) {
  const base = `https://${site}/rest/api/3/`;
  const auth = 'Basic ' + b64(`${email}:${token}`);

  async function request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
    let delay = 1000;
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        res = await fetch(base + path, {
          method,
          headers: { Authorization: auth, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: ctl.signal,
        });
      } catch (e: any) {
        if (attempt < 4) { await sleep(delay); delay *= 2; continue; }
        throw new JiraError(`Could not reach Jira (${e?.name === 'AbortError' ? 'timed out' : 'unreachable'}).`, 0);
      } finally { clearTimeout(timer); }
      if ((res.status === 429 || res.status === 503) && attempt < 4) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 60_000) : delay);
        delay *= 2;
        continue;
      }
      if (!res.ok) {
        const hint = res.status === 401 ? ' — check the email and API token'
          : res.status === 403 ? ' — your Jira account lacks access'
          : res.status === 404 ? ' — not found (check the key and site)' : '';
        throw new JiraError(`Jira ${res.status} on ${path.split('?')[0]}${hint}`, res.status);
      }
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }
  }

  /** every issue for a JQL query (paged) */
  async function search(jql: string, fields: string[], cap = 2000): Promise<any[]> {
    const out: any[] = [];
    let nextPageToken: string | undefined;
    while (out.length < cap) {
      const r = await request('POST', 'search/jql', { jql, fields, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) });
      out.push(...(r?.issues ?? []));
      nextPageToken = r?.nextPageToken;
      if (!nextPageToken || r?.isLast) break;
    }
    return out;
  }

  /** one page of up to `max` issues, and whether Jira has more */
  async function page(jql: string, fields: string[], max: number): Promise<{ issues: any[]; more: boolean }> {
    const issues: any[] = [];
    let nextPageToken: string | undefined;
    for (;;) {
      const r = await request('POST', 'search/jql', { jql, fields, maxResults: Math.min(100, max - issues.length), ...(nextPageToken ? { nextPageToken } : {}) });
      issues.push(...(r?.issues ?? []));
      nextPageToken = r?.nextPageToken;
      const more = !!nextPageToken && !r?.isLast;
      if (!more || issues.length >= max || !(r?.issues ?? []).length) return { issues: issues.slice(0, max), more: more || issues.length > max };
    }
  }

  let sprintField: string | null | undefined;
  /** the Sprint custom field's id differs per site */
  async function sprintFieldId(): Promise<string | null> {
    if (sprintField !== undefined) return sprintField;
    const list: any[] = (await request('GET', 'field')) ?? [];
    sprintField = list.find((f) => f?.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint')?.id ?? null;
    return sprintField ?? null;
  }

  return {
    /** the token's account — used to check credentials */
    myself: () => request('GET', 'myself'),

    /** the 30 newest release epics in LP */
    async releaseEpics(): Promise<ReleaseEpic[]> {
      const { issues } = await page('project = LP AND issuetype = Epic AND summary ~ "Release" AND summary ~ "Activit*" ORDER BY created DESC', RELEASE_EPIC_FIELDS, RELEASE_EPIC_LIMIT);
      return issues.map(mapReleaseEpic).filter((e): e is ReleaseEpic => !!e);
    },

    /** the epic itself and its children (at most 100; `incomplete` when there are more) */
    async releaseTasks(epicKey: string): Promise<{ epic: ReleaseEpic; tasks: ReleaseTask[]; incomplete: boolean }> {
      if (!RELEASE_EPIC_KEY.test(epicKey)) throw new JiraError('A release epic key looks like LP-12345.', 400);
      const epic = mapReleaseEpic(await request('GET', `issue/${epicKey}?fields=${RELEASE_EPIC_FIELDS.join(',')}`));
      if (!epic) throw new JiraError(`Jira returned nothing for ${epicKey}.`, 404);
      const { issues, more } = await page(`parent = ${epicKey} ORDER BY key ASC`, RELEASE_TASK_FIELDS, RELEASE_TASK_LIMIT);
      return { epic, tasks: issues.map(mapReleaseTask).filter((t): t is ReleaseTask => !!t), incomplete: more };
    },

    /** decision 5: issues in the release's fix version that are not children of the epic */
    async outsideEpic(versionId: string, epicKey: string, max = 200): Promise<{ tickets: OutsideTicket[]; incomplete: boolean }> {
      if (!/^\d{1,12}$/.test(versionId) || !RELEASE_EPIC_KEY.test(epicKey)) return { tickets: [], incomplete: false };
      const { issues, more } = await page(`fixVersion = ${versionId} AND key != ${epicKey} AND (parent is EMPTY OR parent != ${epicKey}) ORDER BY key ASC`, OUTSIDE_FIELDS, max);
      return { tickets: issues.map(mapOutside).filter((t): t is OutsideTicket => !!t), incomplete: more };
    },

    /** what a project tracks, by `track`:
     *   'idea' — the epics linked to (or under) the key, and their tickets
     *   'epic' — the key's own tickets; with none, the key itself is the one ticket
     *   'auto' — Idea → 'idea'; Epic → its own tickets, else its linked epics
     *            (an epic used as an umbrella); Task/Story/Bug → itself */
    async project(key: string, track: ProjectTrack = 'auto'): Promise<ProjectSnapshot> {
      const idea = await request('GET', `issue/${encodeURIComponent(key)}?fields=${[...new Set([...EPIC_FIELDS, 'issuetype'])].join(',')}`);
      const type = idea?.fields?.issuetype;
      const typeName = String(type?.name ?? '');
      const isEpicType = type?.hierarchyLevel === 1 || /epic/i.test(typeName);
      const linkedEpics = async () => (await search(`issuetype = Epic AND (issue in linkedIssues("${key}") OR parent = ${key}) ORDER BY rank`, EPIC_FIELDS))
        .map(mapEpic).filter((e): e is ProjectEpic => !!e);
      const hasChildren = async () => (await search(`parent = ${key} AND issuetype != Epic`, ['summary'], 1)).length > 0;
      let mode: 'idea' | 'epic' = track === 'idea' ? 'idea' : track === 'epic' ? 'epic'
        : /idea/i.test(typeName) ? 'idea' : 'epic';
      let epics: ProjectEpic[] = [];
      if (mode === 'idea') epics = await linkedEpics();
      else if (track === 'auto' && isEpicType && !(await hasChildren())) {
        epics = await linkedEpics();     // an umbrella epic (COS-3815): its linked epics carry the work
        if (epics.length) mode = 'idea';
      }
      if (mode === 'epic' || !epics.length) epics = [mapEpic(idea)!];
      const sf = await sprintFieldId();
      const tickets: ProjectSnapshot['tickets'] = [];
      const assignees = new Map<string, Assignee>();
      const fields = sf ? [...TICKET_FIELDS, sf] : TICKET_FIELDS;
      const add = (r: any, epicOf?: Map<string, string>) => {
        const t = mapTicket(r, tickets.length, sf);
        if (!t) return;
        const { assignee, ...ticket } = t;
        if (epicOf) { ticket.parentKey = ticket.epicKey; ticket.epicKey = epicOf.get(ticket.epicKey) ?? ''; ticket.subtask = true; } // sub-task → its story's epic
        if (!ticket.epicKey) return;
        if (assignee) assignees.set(assignee.accountId, assignee);
        tickets.push(ticket);
      };
      // the epics' children (closed ones too: Delivered and the change table need them)
      for (let i = 0; i < epics.length; i += 40) {
        const keys = epics.slice(i, i + 40).map((e) => e.key).join(', ');
        for (const r of await search(`parent in (${keys}) ORDER BY rank`, fields)) add(r);
      }
      // nothing under the key (a task, or an empty epic tracked on its own): the
      // key itself is the work, so its own estimate and time drive the numbers
      if (!tickets.length && epics.length === 1 && epics[0].key === key) {
        for (const r of await search(`key = ${key}`, fields, 1)) { r.fields = { ...r.fields, parent: { key } }; add(r); }
      }
      // their sub-tasks, which inherit the story's epic
      const storyEpic = new Map(tickets.map((t) => [t.key, t.epicKey]));
      const stories = [...storyEpic.keys()];
      for (let i = 0; i < stories.length; i += 100) {
        for (const r of await search(`parent in (${stories.slice(i, i + 100).join(', ')}) ORDER BY rank`, fields, 5000)) add(r, storyEpic);
      }
      return {
        key, tracked: mode, issueType: typeName, summary: String(idea?.fields?.summary ?? ''), status: String(idea?.fields?.status?.name ?? ''),
        dueDate: typeof idea?.fields?.duedate === 'string' ? idea.fields.duedate : null,
        estimateDays: mapEpic(idea)?.estimateDays ?? null, // the project's high-level original estimate: the baseline
        fetchedAt: new Date().toISOString(), epics, tickets, assignees: [...assignees.values()],
      };
    },
  };
}

/** what a project pulls from Jira — see project() */
export type ProjectTrack = 'auto' | 'idea' | 'epic';

export interface ProjectSnapshot {
  key: string; summary: string; status: string; dueDate: string | null; fetchedAt: string;
  /** how it was pulled: the key's linked epics, or the key's own tickets (absent on older snapshots) */
  tracked?: 'idea' | 'epic'; issueType?: string;
  /** original estimate on the project's own issue (absent on older snapshots) */
  estimateDays?: number | null;
  epics: ProjectEpic[]; tickets: Ticket[]; assignees: Assignee[];
}
