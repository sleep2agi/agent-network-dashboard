/* Round 204 verification: legend count text recedes when its status
 * tier is empty (count = 0). Pre-R204 "0" at opacity 0.65 read
 * visually identical to "12" at opacity 0.65; R204 drops empty rows
 * to 0.30 (dark) / 0.28 (light) so the eye gets a "no nodes in this
 * tier" signal without parsing the digit.
 *
 * Test (cyber dark, all 4 sessions = working → idle=0, offline=0):
 *   1. Three legend count texts present with data-legend-count for
 *      working / idle / offline.
 *   2. Working row: count='4', data-legend-count-empty='false',
 *      opacity = 0.65 (idle, not hovered).
 *   3. Idle row: count='0', data-legend-count-empty='true',
 *      opacity ≈ 0.30 (dim recede).
 *   4. Offline row: count='0', data-legend-count-empty='true',
 *      opacity ≈ 0.30.
 *   5. Hover working row → its count bumps to opacity ~0.95
 *      (existing R95 hover behaviour unbroken).
 *   6. Hover idle row → empty-tier opacity DOES NOT bump (empty
 *      gate wins over hover). Recedes regardless.
 *   7. Transition: opacity 150ms ease-out still on all three.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

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
  // All 4 working — idle / offline tiers empty
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-legend-count="working"]', { timeout: 10000 });
await page.waitForTimeout(300);

const probe = async () => page.evaluate(() => {
  const pick = (key) => {
    const el = document.querySelector(`[data-legend-count="${key}"]`);
    if (!el) return null;
    return {
      key,
      text:        el.textContent,
      empty:       el.getAttribute('data-legend-count-empty'),
      opacity:     parseFloat(el.getAttribute('opacity') || ''),
      transition:  el.style.transition,
    };
  };
  return { working: pick('working'), idle: pick('idle'), offline: pick('offline') };
});

const idle = await probe();

// Hover the working row — verify R95 hover bump still fires (count > 0)
await page.hover('[data-legend-status="working"]');
await page.waitForTimeout(200);
const hovWorking = await probe();

// Move off, then hover the empty (idle=0) row — verify empty gate wins
await page.mouse.move(0, 0);
await page.waitForTimeout(200);
await page.hover('[data-legend-status="idle"]');
await page.waitForTimeout(200);
const hovIdle = await probe();

await page.mouse.move(0, 0);
await page.waitForTimeout(200);

await browser.close();

const opacityNear = (got, want, tol = 0.04) => Math.abs(got - want) < tol;

const results = {
  working_present:           !!idle?.working,
  idle_present:              !!idle?.idle,
  offline_present:           !!idle?.offline,

  working_text_4:            idle?.working?.text === '4',
  working_not_empty:         idle?.working?.empty === 'false',
  working_opacity_0p65:      opacityNear(idle?.working?.opacity ?? 0, 0.65),

  idle_text_0:               idle?.idle?.text === '0',
  idle_empty_true:           idle?.idle?.empty === 'true',
  idle_opacity_dim:          opacityNear(idle?.idle?.opacity ?? 0, 0.30),

  offline_text_0:            idle?.offline?.text === '0',
  offline_empty_true:        idle?.offline?.empty === 'true',
  offline_opacity_dim:       opacityNear(idle?.offline?.opacity ?? 0, 0.30),

  // R95 hover still bumps when row populated
  working_hover_opacity_high: opacityNear(hovWorking?.working?.opacity ?? 0, 0.95),

  // Empty-gate wins: hovering an empty row does NOT bump its count opacity
  idle_hover_stays_dim:       opacityNear(hovIdle?.idle?.opacity ?? 0, 0.30),

  // Transition still in place across all 3
  all_have_transition:        ['working', 'idle', 'offline'].every(k =>
    /opacity\s+(?:150ms|0\.15s)/.test(idle?.[k]?.transition || '')),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend count empty:`, JSON.stringify(results),
  `\n  idle:`,        idle,
  `\n  hovWorking:`,  hovWorking,
  `\n  hovIdle:`,     hovIdle);
process.exit(ok ? 0 : 1);
