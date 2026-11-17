// Keychain-backed credentials (tinyjs app.secrets → macOS Keychain generic
// passwords under the app id). The key lives ONLY here: never in SQLite,
// config files, logs or the page. One key per team (see teams.ts); calls
// default to the first selected team.
import { primaryTeam, secretName } from './teams.ts';

const KEY = 'bamboohr.apiKey';
const DOMAIN = 'bamboohr.companyDomain';
const SLACK = 'digest.slackWebhook';

const n = (name: string, team = primaryTeam().id) => secretName(team, name);

export async function getCredentials(app: TinyApp, team?: string): Promise<{ companyDomain: string; apiKey: string } | null> {
  const [apiKey, companyDomain] = await Promise.all([app.secrets.get(n(KEY, team)), app.secrets.get(n(DOMAIN, team))]);
  return apiKey && companyDomain ? { apiKey, companyDomain } : null;
}

export async function setCredentials(app: TinyApp, companyDomain: string, apiKey: string, team?: string) {
  await app.secrets.set(n(DOMAIN, team), companyDomain);
  await app.secrets.set(n(KEY, team), apiKey);
}

// the Slack digest is app-wide (it covers whatever teams are selected)
export async function getSlackWebhook(app: TinyApp): Promise<string | null> {
  return app.secrets.get(SLACK);
}
export async function setSlackWebhook(app: TinyApp, url: string | null) {
  if (url) await app.secrets.set(SLACK, url); else await app.secrets.delete(SLACK);
}

export async function clearAll(app: TinyApp, team?: string) {
  await Promise.all([app.secrets.delete(n(KEY, team)), app.secrets.delete(n(DOMAIN, team))]);
}

// Jira (read-only, app-wide): site + account email + API token, all Keychain
const JIRA_SITE = 'jira.site', JIRA_EMAIL = 'jira.email', JIRA_TOKEN = 'jira.apiToken';
export async function getJira(app: TinyApp): Promise<{ site: string; email: string; token: string } | null> {
  const [site, email, token] = await Promise.all([app.secrets.get(JIRA_SITE), app.secrets.get(JIRA_EMAIL), app.secrets.get(JIRA_TOKEN)]);
  return site && email && token ? { site, email, token } : null;
}
export async function setJira(app: TinyApp, v: { site: string; email: string; token: string } | null) {
  if (!v) { await Promise.all([JIRA_SITE, JIRA_EMAIL, JIRA_TOKEN].map((k) => app.secrets.delete(k))); return; }
  await app.secrets.set(JIRA_SITE, v.site);
  await app.secrets.set(JIRA_EMAIL, v.email);
  await app.secrets.set(JIRA_TOKEN, v.token);
}
