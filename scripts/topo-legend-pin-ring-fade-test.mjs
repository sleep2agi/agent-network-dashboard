/* Round 181 verification: legend row pinned-state ring (R61) is
 * now always-mounted with opacity-gated visibility + 150ms
 * transition — smooth fade in/out on pin / unpin.
 *
 * Pre-R181 the ring mounted/unmounted conditionally, snapping
 * on every state change. Same vocabulary as R165/R180 smooth-
 * pin-mirror family, applied at the legend-row scope.
 *
 * Test:
 *   1. Idle: ring exists in DOM but opacity=0
 *   2. Click 'working' legend row → ring for working = opacity=1
 *   3. Other rings (idle / offline) stay opacity=0
 *   4. Re-click 'working' → unpin → opacity returns to 0
 *   5. All rings carry 'opacity 150ms ease-out' transition
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
const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status, last) => ({
    alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: last, updated_at: last, last_seen_at: last,
  });
  // Mix of statuses so all three legend rows render
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('w1', 'working', fresh), mk('w2', 'working', fresh),
    mk('i1', 'idle',    fresh),
    mk('o1', 'offline', stale),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-legend-pin-ring]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = () => page.evaluate(() => {
  const grab = (k) => {
    const r = document.querySelector(`[data-legend-pin-ring="${k}"]`);
    return r ? {
      opacity:    parseFloat(r.getAttribute('opacity') || ''),
      pinnedAttr: r.getAttribute('data-legend-pin-ring-pinned'),
      transition: r.style.transition || getComputedStyle(r).transition,
    } : null;
  };
  return {
    working: grab('working'),
    idle:    grab('idle'),
    offline: grab('offline'),
  };
});

const idle = await probe();

// Pin 'working' status by clicking the legend row
await page.locator('[data-legend-status="working"]').click();
await page.waitForTimeout(250);
const afterPin = await probe();

// Re-click to unpin
await page.locator('[data-legend-status="working"]').click();
await page.waitForTimeout(250);
const afterUnpin = await probe();

await browser.close();

const hasTransition = (s) =>
  (s?.transition || '').includes('opacity 150ms') ||
  /opacity\s+0\.15s|opacity\s+150ms/.test(s?.transition || '');

const results = {
  // Idle (no pin)
  three_rings_present:       idle.working !== null && idle.idle !== null && idle.offline !== null,
  idle_working_opacity_0:    idle.working?.opacity === 0,
  idle_idle_opacity_0:       idle.idle?.opacity === 0,
  idle_offline_opacity_0:    idle.offline?.opacity === 0,
  all_have_transition:       hasTransition(idle.working) && hasTransition(idle.idle) && hasTransition(idle.offline),

  // After pin working
  pin_working_opacity_1:     afterPin.working?.opacity === 1,
  pin_working_pinned_attr:   afterPin.working?.pinnedAttr === 'true',
  pin_idle_stays_0:          afterPin.idle?.opacity === 0,
  pin_offline_stays_0:       afterPin.offline?.opacity === 0,

  // After unpin
  unpin_working_opacity_0:   afterUnpin.working?.opacity === 0,
  unpin_working_pinned_attr: afterUnpin.working?.pinnedAttr === 'false',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend pin-ring fade:`, JSON.stringify(results),
  `\n  idle =`, idle,
  `\n  pinned =`, afterPin,
  `\n  unpinned =`, afterUnpin);
process.exit(ok ? 0 : 1);
