/* Round 180 verification: working / online / vendor-letter chips
 * pick up box-shadow transition on pin/unpin.
 *
 * Pre-R180 the inset-ring pin-mirror style snapped instantly when
 * the user pinned or unpinned a filter via these three chip
 * surfaces. R165 had added the transition to pressure-bar
 * segments only — R180 closes the smooth-pin-mirror family
 * across all chip-row pinnable surfaces.
 *
 * Test:
 *   1. Mock 3 working sessions across 2 vendors (claude + 书生)
 *   2. Probe inline transition on working / online / vendor chips
 *   3. All three should have 'box-shadow 150ms ease-out' in their
 *      inline transition style
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
  // Two distinct vendor families so vendor letter chip shows up
  // (vendorDist.length > 1 requirement).
  const mk = (alias, model) => ({
    alias, status: 'working', model, runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4'),
    mk('beta',  'claude-opus-4'),
    mk('gamma', 'intern-s1-mini'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-working-chip]', { timeout: 10000 });
await page.waitForSelector('[data-vendor-letter]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = async () => page.evaluate(() => {
  const grab = (sel) => {
    const el = document.querySelector(sel);
    return el ? {
      transition: el.style.transition || getComputedStyle(el).transition || '',
      boxShadow:  el.style.boxShadow || getComputedStyle(el).boxShadow || '',
    } : null;
  };
  return {
    working: grab('[data-working-chip]'),
    online:  grab('[data-online-chip-clickable]'),
    vendor:  grab('[data-vendor-letter]'),
  };
});

const idle = await probe();

// Click the working chip to pin → boxShadow should appear
await page.locator('[data-working-chip]').click();
await page.waitForTimeout(250);
const pinnedWorking = await probe();

await browser.close();

const hasTransition = (s) =>
  (s?.transition || '').includes('box-shadow 150ms') ||
  /box-shadow\s+0\.15s|box-shadow\s+150ms/.test(s?.transition || '');

const results = {
  working_found:                idle.working !== null,
  online_found:                 idle.online !== null,
  vendor_found:                 idle.vendor !== null,
  working_has_bs_transition:    hasTransition(idle.working),
  online_has_bs_transition:     hasTransition(idle.online),
  vendor_has_bs_transition:     hasTransition(idle.vendor),
  // Pre-pin: no inset rings on working chip
  working_idle_no_inset:        !(idle.working?.boxShadow || '').includes('inset'),
  // After pin: inset rings appear, transition still set
  working_pinned_has_inset:     (pinnedWorking.working?.boxShadow || '').includes('inset'),
  working_pinned_keeps_transition: hasTransition(pinnedWorking.working),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} pin-mirror transition:`, JSON.stringify(results),
  `\n  idle =`, idle,
  `\n  pinned =`, pinnedWorking);
process.exit(ok ? 0 : 1);
