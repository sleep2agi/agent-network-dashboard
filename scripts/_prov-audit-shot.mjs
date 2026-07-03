// /providers design audit — capture current state (collapsed list) at desktop
// + mobile, light + dark, against the :9236 e2e hub (2 providers populated).
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
const BASE = 'http://127.0.0.1:3018', U = process.env.DRYRUN_USER, P = process.env.DRYRUN_PW;
const OUT = '/tmp/prov-audit'; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
for (const theme of ['light', 'dark']) {
  for (const [vp, w, h] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const pg = await ctx.newPage();
    await pg.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await pg.evaluate(async ({ u, p, theme }) => {
      const r = await fetch('/api/auth/v3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', username: u, password: p }) });
      const d = await r.json();
      if (d.ok && d.token) sessionStorage.setItem('anet_v3_auth', JSON.stringify({ user: d.user, token: d.token, networks: d.networks || [], currentNetwork: d.network_id || d.networks?.[0]?.network_id || '' }));
      localStorage.setItem('anet-theme', theme);
    }, { u: U, p: P, theme });
    await pg.goto(`${BASE}/providers`, { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(2200);
    await pg.screenshot({ path: `${OUT}/providers-${theme}-${vp}.png`, fullPage: true });
    // also open the create modal once (desktop light only) to audit the form
    if (theme === 'light' && vp === 'desktop') {
      await pg.getByRole('button', { name: /新增供应商/ }).first().click();
      await pg.waitForTimeout(600);
      await pg.screenshot({ path: `${OUT}/providers-create-modal.png` });
    }
    await ctx.close();
  }
}
console.log('audit shots →', OUT);
await b.close();
