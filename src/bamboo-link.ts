// Deep link to the BambooHR record — approvals happen there, not here.
export async function openInBamboo(url: string) {
  if (!url) return;
  try { await tiny.app.shell.open(url); } catch { /* the OS refused: nothing to do */ }
}
