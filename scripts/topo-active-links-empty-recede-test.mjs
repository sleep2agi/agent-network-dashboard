/* Round 206 verification: active-links chip recedes to opacity 0.5
 * when flowLinks.length === 0, mirroring R204 legend count recede and
 * R205 working/online chip recede patterns at a third scope.
 *
 * Pre-R206 "0 active links" rendered at the same bg-gray-500/10 +
 * opacity 1 as "12 active links" — only the absent cursor + missing
 * tooltip signalled empty. R206 adds the visual recede so all three
 * signals (visual / interactive / affordance) align.
 *
 * Test scenarios:
 *   A. 0 messages → flowLinks.length === 0:
 *      data-active-links-empty='true', clickable='false',
 *      opacity ≈ 0.5
 *   B. 3 messages → flowLinks.length === 3:
 *      data-active-links-empty='false', clickable='true',
 *      opacity = 1.0
 *   Both: inline transition includes color/background-color/
 *   border-color/opacity 200ms (4-property splice).
 *   R193 hover-cyan markup preserved in scenario B className.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function setup(messages) {
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
      alias, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    await route.fulfill({ response: r, json: { ...b, sessions: [
      mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
    ] } });
  });
  await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages } }));
  await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
  await page.waitForSelector('[data-active-links-chip]', { timeout: 10000 });
  await page.waitForTimeout(300);
  return page;
}

const probe = async (page) => page.evaluate(() => {
  const el = document.querySelector('[data-active-links-chip]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    className:  el.getAttribute('class') || '',
    empty:      el.getAttribute('data-active-links-empty'),
    clickable:  el.getAttribute('data-active-links-clickable'),
    flowCount:  el.getAttribute('data-active-links-flow-count'),
    opacity:    parseFloat(cs.opacity),
    transition: el.style.transition,
    bg:         cs.backgroundColor,
  };
});

// Scenario A: empty
const pageA = await setup([]);
const probeA = await probe(pageA);
await pageA.close();

// Scenario B: populated
const now = Date.now();
const pageB = await setup([
  { id: '1', from_alias: 'alpha', to_alias: 'beta',  content: 'hi',
    network_id: 'default', created_at: new Date(now - 1000).toISOString() },
  { id: '2', from_alias: 'beta',  to_alias: 'gamma', content: 'hi',
    network_id: 'default', created_at: new Date(now - 2000).toISOString() },
  { id: '3', from_alias: 'gamma', to_alias: 'delta', content: 'hi',
    network_id: 'default', created_at: new Date(now - 3000).toISOString() },
]);
const probeB = await probe(pageB);
await pageB.close();
await browser.close();

const near = (got, want, tol = 0.05) => Math.abs(got - want) < tol;
const has = (s, re) => re.test(s || '');

const results = {
  // Scenario A: 0 flows
  A_chip_present:           !!probeA,
  A_flow_count_0:           probeA?.flowCount === '0',
  A_empty_true:             probeA?.empty === 'true',
  A_clickable_false:        probeA?.clickable === 'false',
  A_opacity_half:           near(probeA?.opacity ?? 0, 0.5),
  // hover variant NOT present on empty (only base bg-gray)
  A_no_hover_variant:       !(probeA?.className || '').includes('hover:bg-cyan-500/10'),

  // Scenario B: 3 flows
  B_chip_present:           !!probeB,
  B_flow_count_3:           probeB?.flowCount === '3',
  B_empty_false:            probeB?.empty === 'false',
  B_clickable_true:         probeB?.clickable === 'true',
  B_opacity_full:           near(probeB?.opacity ?? 0, 1.0),
  // R193 hover-cyan markup preserved
  B_has_hover_variant:      (probeB?.className || '').includes('hover:bg-cyan-500/10'),

  // Transition integrity — 4-property splice on both scenarios
  A_transition_opacity:     has(probeA?.transition, /opacity\s+(?:200ms|0\.2s)/),
  A_transition_bg:          has(probeA?.transition, /background-color\s+(?:200ms|0\.2s)/),
  A_transition_color:       has(probeA?.transition, /\bcolor\s+(?:200ms|0\.2s)/),
  A_transition_border:      has(probeA?.transition, /border-color\s+(?:200ms|0\.2s)/),
  B_transition_opacity:     has(probeB?.transition, /opacity\s+(?:200ms|0\.2s)/),
  B_transition_bg:          has(probeB?.transition, /background-color\s+(?:200ms|0\.2s)/),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} active-links empty recede:`, JSON.stringify(results),
  `\n  probeA (0 flows):`,  probeA,
  `\n  probeB (3 flows):`,  probeB);
process.exit(ok ? 0 : 1);
