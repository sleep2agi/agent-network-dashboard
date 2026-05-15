/* Round 205 verification: working / online chip-row chips visually
 * recede to opacity 0.5 when their tier is empty, mirroring R204's
 * legend count recede pattern at the chip-row scope.
 *
 * Pre-R205 "0 working" displayed at the same bg-green-500/10 +
 * full opacity as "12 working" — the eye got zero signal that the
 * tier was empty. R205 combines with R139's clickable=false +
 * tooltip-undefined: visual + interactive + affordance all say
 * "nothing to act on".
 *
 * Test scenarios:
 *   A. All offline (0 working, 0 online):
 *      working chip empty='true', opacity ≈ 0.5
 *      online  chip empty='true', opacity ≈ 0.5
 *   B. All working (4 working, 4 online):
 *      working chip empty='false', opacity = 1
 *      online  chip empty='false', opacity = 1
 *   Both: inline transition includes 'opacity 200ms' alongside the
 *   existing R180 box-shadow / R201 bg/border transitions.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function pageFor(allStatus) {
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
    const mk = (alias, status) => ({
      alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    await route.fulfill({ response: r, json: { ...b, sessions: [
      mk('alpha', allStatus), mk('beta', allStatus),
      mk('gamma', allStatus), mk('delta', allStatus),
    ] } });
  });
  await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
  await page.waitForSelector('[data-working-chip]', { timeout: 10000 });
  await page.waitForTimeout(300);
  return page;
}

const probe = async (page) => page.evaluate(() => {
  function pick(sel, emptyKey) {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      empty:      el.getAttribute(emptyKey),
      opacity:    parseFloat(cs.opacity),
      transition: el.style.transition,
    };
  }
  return {
    working: pick('[data-working-chip]', 'data-working-chip-empty'),
    online:  pick('[data-online-chip]',  'data-online-chip-empty'),
  };
});

// Scenario A: all offline → both tiers empty
const pageA = await pageFor('offline');
const probeA = await probe(pageA);
await pageA.close();

// Scenario B: all working → both tiers populated
const pageB = await pageFor('working');
const probeB = await probe(pageB);
await pageB.close();
await browser.close();

const near = (got, want, tol = 0.05) => Math.abs(got - want) < tol;
const hasOpacityTransition = (s) => /opacity\s+(?:200ms|0\.2s)/.test(s || '');
const hasBgTransition = (s) => /background-color\s+(?:200ms|0\.2s)/.test(s || '');
const hasBoxShadowTransition = (s) => /box-shadow\s+(?:150ms|0\.15s)/.test(s || '');

const results = {
  // Scenario A: all offline
  A_working_empty_attr:       probeA.working?.empty === 'true',
  A_working_opacity_half:     near(probeA.working?.opacity ?? 0, 0.5),
  A_online_empty_attr:        probeA.online?.empty === 'true',
  A_online_opacity_half:      near(probeA.online?.opacity ?? 0, 0.5),

  // Scenario B: all working
  B_working_empty_false:      probeB.working?.empty === 'false',
  B_working_opacity_full:     near(probeB.working?.opacity ?? 0, 1.0),
  B_online_empty_false:       probeB.online?.empty === 'false',
  B_online_opacity_full:      near(probeB.online?.opacity ?? 0, 1.0),

  // Transition list integrity — opacity ADDED, bg/border/box-shadow KEPT
  A_working_transition_opacity:    hasOpacityTransition(probeA.working?.transition),
  A_online_transition_opacity:     hasOpacityTransition(probeA.online?.transition),
  B_working_transition_opacity:    hasOpacityTransition(probeB.working?.transition),
  B_online_transition_opacity:     hasOpacityTransition(probeB.online?.transition),
  A_working_keeps_bg_transition:   hasBgTransition(probeA.working?.transition),
  A_working_keeps_bs_transition:   hasBoxShadowTransition(probeA.working?.transition),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chip empty recede:`, JSON.stringify(results),
  `\n  probeA (offline):`, probeA,
  `\n  probeB (working):`, probeB);
process.exit(ok ? 0 : 1);
