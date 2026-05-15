/* Round 176 verification: hub joins the first-paint fade-in
 * family as the 6th surface.
 *
 * Pre-R176 the hub (ring-layout center, visual anchor) popped
 * in instantly while R174 tier rings staggered around it 0-120ms,
 * R9 nodes emanated 0-540ms, R172 edges chased 280-980ms. The
 * focal element wasn't part of the wave it was supposed to be
 * leading.
 *
 * R176 adds .anet-fade-in to the hub <g> at delay 0 — establishes
 * the hub as the canvas-center anchor the tier wave grows from.
 * Composes cleanly with the existing anet-topo-svg-focus class
 * (R159 keyboard focus ring).
 *
 * Test:
 *   1. Force ring layout
 *   2. Mock 3 sessions
 *   3. Probe [data-topo-hub] element
 *   4. Assert className includes BOTH anet-topo-svg-focus AND
 *      anet-fade-in (composition preserved)
 *   5. Assert data-topo-hub-fade-delay=0
 *   6. R159 a11y attrs (role=button, aria-label) still intact
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    localStorage.setItem('anet-topo-layout', 'ring');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta'), mk('gamma')] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-topo-hub]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-hub]');
  if (!el) return null;
  return {
    className:      el.getAttribute('class') || '',
    fadeDelayAttr:  parseFloat(el.getAttribute('data-topo-hub-fade-delay') || ''),
    role:           el.getAttribute('role'),
    tabIndex:       el.getAttribute('tabindex'),
    ariaLabel:      el.getAttribute('aria-label') || '',
  };
});

await browser.close();

const results = {
  hub_found:                probe !== null,
  has_focus_class:          probe?.className.includes('anet-topo-svg-focus'),
  has_fade_class:           probe?.className.includes('anet-fade-in'),
  fade_delay_attr_0:        probe?.fadeDelayAttr === 0,
  // R159 a11y preservation
  r159_role_button:         probe?.role === 'button',
  r159_tabIndex_0:          probe?.tabIndex === '0',
  r159_aria_label_present:  /Network hub/.test(probe?.ariaLabel || ''),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub fade-in:`, JSON.stringify(results),
  `\n  hub =`, probe);
process.exit(ok ? 0 : 1);
