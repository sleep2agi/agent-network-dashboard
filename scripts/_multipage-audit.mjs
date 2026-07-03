// Multi-page design audit — capture key pages (desktop + mobile, light) to
// hunt for a genuine layout/usability issue away from /providers.
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
const BASE = 'http://127.0.0.1:3018', U = process.env.DRYRUN_USER, P = process.env.DRYRUN_PW;
const OUT = '/tmp/mp-audit'; mkdirSync(OUT, { recursive: true });
const PAGES = [['overview', '/'], ['nodes', '/nodes'], ['tasks', '/tasks'], ['admin', '/admin'], ['settings', '/settings'], ['messages', '/messages']];
const b = await chromium.launch();
for (const [vp, w, h] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5 });
  const pg = await ctx.newPage();
  await pg.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await pg.evaluate(async ({ u, p }) => {
    const r = await fetch('/api/auth/v3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', username: u, password: p }) });
    const d = await r.json();
    if (d.ok && d.token) sessionStorage.setItem('anet_v3_auth', JSON.stringify({ user: d.user, token: d.token, networks: d.networks || [], currentNetwork: d.network_id || d.networks?.[0]?.network_id || '' }));
    localStorage.setItem('anet-theme', 'light');
  }, { u: U, p: P });
  for (const [name, path] of PAGES) {
    try {
      await pg.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      await pg.waitForTimeout(2000);
      await pg.screenshot({ path: `${OUT}/${name}-${vp}.png`, fullPage: true });
    } catch (e) { console.log(`${name}/${vp} fail:`, e.message); }
  }
  await ctx.close();
}
console.log('multipage audit →', OUT);
await b.close();
