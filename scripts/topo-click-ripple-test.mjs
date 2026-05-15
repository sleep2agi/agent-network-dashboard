/* Round 14 verification: clicking a node spawns a one-shot ripple circle
 * (strokeWidth=2, status-coloured, ~500ms) that's gone by t=800ms. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.removeItem('anet-brand');
    localStorage.removeItem('anet-topo-view');
    localStorage.setItem('anet-topo-layout', 'grid');
    localStorage.setItem('anet-topo-nodescale', '1');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = ['ripA', 'ripB'].map(a => ({
    alias: a, status: 'idle', network_id: nid, project_dir: null,
    created_at: '2026-05-15T00:00:00Z', updated_at: '2026-05-15T00:00:00Z',
    last_seen_at: new Date().toISOString(),
  }));
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  return !!svg && svg.querySelectorAll('g[data-node]').length >= 2;
}, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(400);

// Ripple circle = direct child of the zoom/pan <g>, strokeWidth=2, with a
// <animate> child whose attributeName="r" (distinguishes it from the
// hover ring, which has strokeWidth=2 but no <animate> children).
const ripplePresent = async () => page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  for (const c of svg.querySelectorAll('circle[stroke-width="2"]')) {
    const anims = c.querySelectorAll('animate');
    if (anims.length && [...anims].some(a => a.getAttribute('attributeName') === 'r')) return true;
  }
  return false;
});

const before = await ripplePresent();
await page.locator('g[data-node="ripA"]').click();
// Sample at ~150ms (mid-animation) — ripple should be present.
await page.waitForTimeout(150);
const during = await ripplePresent();
// After 800ms total — well past the 600ms clear timer.
await page.waitForTimeout(700);
const after = await ripplePresent();

await browser.close();
const results = { noRippleBefore: before === false, rippleDuring: during === true, rippleClearedAfter: after === false };
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} click ripple:`, JSON.stringify(results));
process.exit(ok ? 0 : 1);
