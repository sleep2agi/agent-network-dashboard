/* Round 51 verification: hovered node <g> lifts -2px via CSS transform.
 *  - At rest, every node's CSS transform is "none" (or matrix with 0 ty).
 *  - On hover, the hovered <g> reports `translateY(-2px)` (matrix(1,0,0,1,0,-2))
 *    via getComputedStyle.transform, while siblings stay at identity.
 *  - Release: returns to identity.
 *  - With prefers-reduced-motion forced, NO lift even on hover.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function probe(reducedMotion) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-topo-layout', 'ring');
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  });
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const sessions = ['alpha', 'beta', 'gamma'].map(a => ({
      alias: a, status: 'idle', network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    }));
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
  await page.waitForTimeout(500);

  const readTy = (alias) => page.evaluate(a => {
    const el = document.querySelector(`g[data-node="${a}"]`);
    if (!el) return null;
    const m = getComputedStyle(el).transform;
    if (!m || m === 'none') return 0;
    // matrix(a, b, c, d, tx, ty) — extract ty
    const parts = m.match(/matrix\(([^)]+)\)/);
    if (!parts) return null;
    const arr = parts[1].split(',').map(s => parseFloat(s.trim()));
    return arr[5] ?? null;
  }, alias);

  const restAlpha = await readTy('alpha');
  const restBeta = await readTy('beta');
  await page.locator('g[data-node="alpha"]').hover({ force: true });
  await page.waitForTimeout(300);
  const hoveredAlpha = await readTy('alpha');
  const hoveredBeta  = await readTy('beta');
  await page.mouse.move(10, 10);
  await page.waitForTimeout(300);
  const releasedAlpha = await readTy('alpha');

  await ctx.close();
  return { restAlpha, restBeta, hoveredAlpha, hoveredBeta, releasedAlpha };
}

const normal = await probe(false);
const reduced = await probe(true);
await browser.close();

const results = {
  normal_restAtZero: normal.restAlpha === 0 && normal.restBeta === 0,
  normal_hoveredLifts: normal.hoveredAlpha === -2,
  normal_siblingStays: normal.hoveredBeta === 0,
  normal_released: normal.releasedAlpha === 0,
  reduced_noLift: reduced.hoveredAlpha === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} node hover lift:`, JSON.stringify(results),
  `\n  normal=`, normal, `\n  reduced=`, reduced);
process.exit(ok ? 0 : 1);
