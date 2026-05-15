/* Round 26 verification: hovering a node lifts its label group up by
 * 1.5 px (CSS transform stacked on the SVG positioning translate). Both
 * the full-card path (sparse fleet) and the dense plain-text path
 * (large fleet) should respond. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function probe(fleetSize) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-topo-layout', 'grid');
      localStorage.setItem('anet-topo-nodescale', '1');
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  });
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const sessions = Array.from({ length: fleetSize }, (_, i) => ({
      alias: `lab${i + 1}`, status: 'idle', network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    }));
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((n) => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    return !!svg && svg.querySelectorAll('g[data-node]').length === n;
  }, fleetSize, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);

  // Re-query the label element fresh each sample — React re-renders on
  // hover (hoveredAlias state change) so any element handle captured
  // before the hover would be detached/stale by the time we read its
  // post-hover position.
  const readLabelTop = () => page.evaluate(() => {
    const node = document.querySelector('g[data-node="lab1"]');
    if (!node) return null;
    const full = [...node.querySelectorAll('g')].find(g => /group-hover:-translate-y/.test(g.getAttribute('class') || ''));
    const el = full || [...node.querySelectorAll('text')].find(t => /group-hover:-translate-y/.test(t.getAttribute('class') || ''));
    return el ? el.getBoundingClientRect().top : null;
  });

  const beforeY = await readLabelTop();
  await page.locator('g[data-node="lab1"]').hover();
  await page.waitForTimeout(300);
  const afterY = await readLabelTop();

  await ctx.close();
  return { beforeY, afterY };
}

const sparse = await probe(4);
// Note: in dense mode the same alias's hover triggers `showFullLabel`,
// which swaps the plain-text element for the full-card <g>. That path
// switch makes a same-element before/after comparison meaningless.
// The plain-text element still carries the same hover-lift class, so
// the lift wiring is verified at the DOM level via the second probe.
const denseClassPresent = await (async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
  const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    localStorage.setItem('anet-topo-layout', 'grid');
    localStorage.setItem('anet-topo-nodescale', '1');
    sessionStorage.setItem('anet_v3_auth', '1');
  });
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const sessions = Array.from({ length: 28 }, (_, i) => ({
      alias: `lab${i + 1}`, status: 'idle', network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    }));
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 28, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
  const has = await page.evaluate(() => {
    const node = document.querySelector('g[data-node="lab2"]'); // not the one we'd hover
    if (!node) return false;
    const t = [...node.querySelectorAll('text')].find(x => /group-hover:-translate-y/.test(x.getAttribute('class') || ''));
    return !!t;
  });
  await ctx.close();
  return has;
})();

await browser.close();

const lifted = (m) => m.beforeY != null && m.afterY != null && m.beforeY - m.afterY >= 1 && m.beforeY - m.afterY <= 2.5;

const results = {
  sparseLabelLifts: lifted(sparse),
  densePlainTextHasLiftClass: denseClassPresent,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} label hover lift:`, JSON.stringify(results),
  `sparse=Δ${(sparse.beforeY - sparse.afterY)?.toFixed(2)}px`);
process.exit(ok ? 0 : 1);
