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
