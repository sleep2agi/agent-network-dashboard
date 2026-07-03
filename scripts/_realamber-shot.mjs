// real-amber demo — DeepSeek provider + invalid vault key → real HTTPS 401 from
// api.deepseek.com → auth_fail → amber matrix cell. Proves the full live chain
// (no mock): dashboard → /api/anet/providers/probe → probe_provider_model →
// daemon real fetch → get_probe_results. Run against the isolated :9236 e2e hub.
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const BASE = 'http://127.0.0.1:3018';
const U = process.env.DRYRUN_USER, P = process.env.DRYRUN_PW;
const THEME = process.env.SHOT_THEME || 'light';
const OUT = '/tmp/realamber';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const pg = await ctx.newPage();

await pg.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await pg.evaluate(async ({ u, p, theme }) => {
  const r = await fetch('/api/auth/v3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', username: u, password: p }) });
  const d = await r.json();
  if (d.ok && d.token) sessionStorage.setItem('anet_v3_auth', JSON.stringify({ user: d.user, token: d.token, networks: d.networks || [], currentNetwork: d.network_id || d.networks?.[0]?.network_id || '' }));
  localStorage.setItem('anet-theme', theme);
}, { u: U, p: P, theme: THEME });

await pg.goto(`${BASE}/providers`, { waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(2500);

// click DeepSeek's Test button (the one provider with the bad key → amber)
const row = pg.locator('[data-provider="DeepSeek"]');
await row.waitFor({ timeout: 10000 });
await row.getByRole('button', { name: /^Test/ }).click();
console.log('clicked DeepSeek Test → matrix dispatching real probe…');

// poll the DOM until the cell resolves out of the pending spinner (max ~30s)
let resolved = false;
for (let i = 0; i < 15; i++) {
  await pg.waitForTimeout(2000);
  const txt = await row.innerText();
  if (/401|auth|key|ms|reject|amber/i.test(txt) && !/probing|pending/i.test(txt)) { resolved = true; console.log(`resolved after ${(i + 1) * 2}s`); break; }
}
if (!resolved) console.log('cell still pending after 30s — capturing anyway');
await pg.waitForTimeout(800);

await row.scrollIntoViewIfNeeded();
await pg.screenshot({ path: `${OUT}/deepseek-matrix-${THEME}.png` });
// tight crop of just the DeepSeek row+matrix
const box = await row.boundingBox();
if (box) await pg.screenshot({ path: `${OUT}/deepseek-cell-${THEME}.png`, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height + 8, 900 - box.y) } });
console.log('real-amber shots saved →', OUT);
await b.close();
