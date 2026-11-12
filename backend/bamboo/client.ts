// BambooHR REST client. Base URL, Basic auth (key as username, any string as
// password) and Accept: application/json follow BambooHR's API docs (verify).
// Retries 429/503 with exponential backoff: 1 s, 2 s, 4 s, 8 s — 5 tries total.
// NEVER logs the key or response bodies — errors carry status + path only.

export class BambooError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export interface BambooClient {
  get(path: string, query?: Record<string, string>): Promise<any>;
  post(path: string, body: unknown, query?: Record<string, string>): Promise<any>;
  put(path: string, body: unknown): Promise<any>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function cleanDomain(input: string): string {
  // accept "acme", "acme.bamboohr.com" or a pasted https://acme.bamboohr.com/… url
  let d = String(input || '').trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').split('/')[0].replace(/\.bamboohr\.com$/, '');
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(d)) throw new Error('Company domain should look like "acme" (from acme.bamboohr.com).');
  return d;
}

export function createClient(companyDomain: string, apiKey: string, opts: { timeoutMs?: number } = {}): BambooClient {
  const base = `https://api.bamboohr.com/api/gateway.php/${encodeURIComponent(companyDomain)}/v1/`;
  const auth = 'Basic ' + b64(`${apiKey}:x`);
  const timeoutMs = opts.timeoutMs ?? 30_000;

  async function request(method: string, path: string, query?: Record<string, string>, body?: unknown) {
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    const url = base + path.replace(/^\//, '') + qs;
    let delay = 1000;
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeoutMs);
        try {
          res = await fetch(url, {
            method,
            headers: {
              Authorization: auth,
              Accept: 'application/json',
              ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: ctl.signal,
          });
        } finally { clearTimeout(timer); }
      } catch (e: any) {
        if (attempt < 5) { await sleep(delay); delay *= 2; continue; }
        throw new BambooError(`Network error calling BambooHR (${path}): ${e?.name === 'AbortError' ? 'timed out' : 'unreachable'}`, 0);
      }
      if ((res.status === 429 || res.status === 503) && attempt < 5) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 60_000) : delay);
        delay *= 2;
        continue;
      }
      if (!res.ok) {
        const hint = res.status === 401 ? ' — check the API key'
          : res.status === 403 ? ' — your BambooHR account lacks access to this data'
          : res.status === 404 ? ' — check the company domain' : '';
        throw new BambooError(`BambooHR ${res.status} on ${path}${hint}`, res.status);
      }
      const text = await res.text();
      if (!text) return null;
      try { return JSON.parse(text); }
      catch { throw new BambooError(`BambooHR returned non-JSON for ${path}`, res.status); }
    }
  }

  return {
    get: (path, query) => request('GET', path, query),
    post: (path, body, query) => request('POST', path, query, body),
    put: (path, body) => request('PUT', path, undefined, body),
  };
}
