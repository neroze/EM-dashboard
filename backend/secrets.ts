// Keychain-backed credentials (tinyjs app.secrets → macOS Keychain generic
// passwords under the app id). The key lives ONLY here: never in SQLite,
// config files, logs or the page.
const KEY = 'bamboohr.apiKey';
const DOMAIN = 'bamboohr.companyDomain';
const SLACK = 'digest.slackWebhook';

export async function getCredentials(app: TinyApp): Promise<{ companyDomain: string; apiKey: string } | null> {
  const [apiKey, companyDomain] = await Promise.all([app.secrets.get(KEY), app.secrets.get(DOMAIN)]);
  return apiKey && companyDomain ? { apiKey, companyDomain } : null;
}

export async function setCredentials(app: TinyApp, companyDomain: string, apiKey: string) {
  await app.secrets.set(DOMAIN, companyDomain);
  await app.secrets.set(KEY, apiKey);
}

export async function getSlackWebhook(app: TinyApp): Promise<string | null> {
  return app.secrets.get(SLACK);
}
export async function setSlackWebhook(app: TinyApp, url: string | null) {
  if (url) await app.secrets.set(SLACK, url); else await app.secrets.delete(SLACK);
}

export async function clearAll(app: TinyApp) {
  await Promise.all([app.secrets.delete(KEY), app.secrets.delete(DOMAIN), app.secrets.delete(SLACK)]);
}
