/* Round 221 verification: recent-signal panel "+N more" footer
 * always-mounts; visibility crossfades via wrapper <g> opacity
 * instead of React conditional mount/unmount on flowLinks > 3.
 *
 * Pre-R221 a fleet's 4th flow appearing snap-popped the footer
 * into the canvas; tapering back to 3 flows snap-removed it.
 * Same threshold-crossing snap R215 closed for edge midpoint
 * badges, now applied to the recent-panel footer surface.
 *
 * Test scenarios:
 *   A. 2 flows (below threshold)  → footer in DOM, visible='false',
 *                                    opacity=0, pointerEvents='none',
 *                                    aria-hidden='true', role unset,
 *                                    tabIndex=-1
 *   B. 5 flows (visible threshold) → footer visible='true',
 *                                    opacity>0, role='link', tabIndex=0
 *   Both: inline transition includes 'opacity 300ms'.
 *   moreCount text content clamps at 0 / 2 respectively.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function setup(n) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
  });
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const mk = (alias) => ({
      alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    await route.fulfill({ response: r, json: { ...b, sessions: [
      mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
    ] } });
  });
  const now = Date.now();
  // Need N distinct flow pairs → mock N messages with distinct alias pairs
  const pairs = [
    ['alpha', 'beta'], ['beta', 'gamma'], ['gamma', 'delta'],
    ['delta', 'alpha'], ['alpha', 'gamma'], ['beta', 'delta'],
  ];
  const msgs = pairs.slice(0, n).map((p, i) => ({
    id: `m${i}`, from_alias: p[0], to_alias: p[1], content: 'hi',
    network_id: 'default', created_at: new Date(now - (1000 + i * 500)).toISOString(),
  }));
  await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: msgs } }));
  await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
  await page.waitForSelector('[data-recent-panel-more-nav]', { timeout: 10000, state: 'attached' });
  await page.waitForTimeout(400);
  return page;
}

const probe = async (page) => page.evaluate(() => {
  const el = document.querySelector('[data-recent-panel-more-nav]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  const txt = el.querySelector('[data-recent-panel-more]');
  return {
    visible:        el.getAttribute('data-recent-panel-more-visible'),
    role:           el.getAttribute('role'),
    tabIndex:       el.getAttribute('tabindex'),
    ariaHidden:     el.getAttribute('aria-hidden'),
    opacity:        parseFloat(cs.opacity),
    computedPointer:cs.pointerEvents,
    transition:     el.style.transition,
    moreText:       txt?.textContent,
    moreCount:      txt?.getAttribute('data-recent-panel-more'),
  };
});

// Scenario A: 2 flows (below threshold)
const pageA = await setup(2);
const probeA = await probe(pageA);
await pageA.close();

// Scenario B: 5 flows (above threshold)
const pageB = await setup(5);
const probeB = await probe(pageB);
await pageB.close();
await browser.close();

const results = {
  // Scenario A (2 flows, hidden)
  A_present_in_dom:        !!probeA,
  A_visible_false:         probeA?.visible === 'false',
  A_opacity_0:             probeA?.opacity === 0,
  A_pointer_none:          probeA?.computedPointer === 'none',
  A_aria_hidden:           probeA?.ariaHidden === 'true',
  A_role_unset:            probeA?.role === null || probeA?.role === '',
  A_tabindex_neg:          probeA?.tabIndex === '-1',
  A_more_count_0:          probeA?.moreCount === '0',  // clamped at 0

  // Scenario B (5 flows, visible)
  B_present_in_dom:        !!probeB,
  B_visible_true:          probeB?.visible === 'true',
  B_opacity_positive:      (probeB?.opacity ?? 0) > 0,
  B_pointer_all:           probeB?.computedPointer === 'all',
  B_role_link:             probeB?.role === 'link',
  B_tabindex_0:            probeB?.tabIndex === '0',
  B_more_count_2:          probeB?.moreCount === '2',
  B_text_says_2:           /^\+\s*2\s*more flow/.test(probeB?.moreText || ''),

  // Both scenarios have opacity 300ms transition
  A_has_transition:        /opacity\s+(?:300ms|0\.3s)/.test(probeA?.transition || ''),
  B_has_transition:        /opacity\s+(?:300ms|0\.3s)/.test(probeB?.transition || ''),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-panel more crossfade:`, JSON.stringify(results),
  `\n  probeA (2 flows hidden):`, probeA,
  `\n  probeB (5 flows visible):`, probeB);
process.exit(ok ? 0 : 1);
