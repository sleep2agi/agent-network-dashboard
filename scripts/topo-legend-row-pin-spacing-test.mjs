/* Round 219 verification: legend row text gets letter-spacing pin
 * signature 0px → 0.5px, mirroring R218 group label treatment.
 * Pre-R219 hover and pin shared fill colour and were typographically
 * identical at letter form.
 *
 * Test (cyber dark, 4 working sessions):
 *   1. Three legend rows (working / idle / offline) render with
 *      data-legend-row-label.
 *   2. Idle: data-legend-row-label-pinned='false' on all rows,
 *      computed letter-spacing ~ 0 (CSS resolves '0px' → 'normal').
 *   3. Inline transition includes 'letter-spacing 150ms'.
 *   4. Click the working legend row → that row becomes pinned.
 *   5. Working row: pinned='true', letter-spacing ~ 0.5px.
 *   6. Other rows (idle / offline) stay unpinned + 0 spacing.
 *   7. Click pinned row again → unpin → back to 0 spacing.
 *
 * Same 'normal' vs '0px' CSS-equivalence parser as R218 (CSS
 * resolves letter-spacing: 0px to keyword 'normal' in computed style).
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
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-legend-row-label]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

const probe = async () => page.evaluate(() => {
  return [...document.querySelectorAll('[data-legend-row-label]')].map(el => {
    const cs = getComputedStyle(el);
    return {
      key:         el.getAttribute('data-legend-row-label'),
      pinned:      el.getAttribute('data-legend-row-label-pinned'),
      spacing:     cs.letterSpacing,
      transition:  el.style.transition,
    };
  });
});

const idle = await probe();

// Click the working row to pin it. Use the row wrapper <g
// data-legend-status="working"> to ensure the click hits the hit
// area (the text itself has pointerEvents:'none' via the parent <g>).
await page.click('[data-legend-status="working"]');
await page.waitForTimeout(200);
const pinned = await probe();

await page.click('[data-legend-status="working"]');
await page.waitForTimeout(200);
const unpinned = await probe();

await browser.close();

// CSS resolves letter-spacing: 0px to 'normal' in computed style.
// Accept both forms as "zero spacing".
const near = (s, want, tol = 0.15) => {
  if (want === 0 && (s === 'normal' || s === '0px' || s === '0' || !s)) return true;
  const got = parseFloat(s || '0');
  return Math.abs(got - want) < tol;
};
const hasLetterSpacingT = (s) => /letter-spacing\s+(?:150ms|0\.15s)/.test(s || '');

const idleWorking   = idle.find(p => p.key === 'working');
const idleIdle      = idle.find(p => p.key === 'idle');
const idleOffline   = idle.find(p => p.key === 'offline');
const pinWorking    = pinned.find(p => p.key === 'working');
const pinIdle       = pinned.find(p => p.key === 'idle');
const unpinWorking  = unpinned.find(p => p.key === 'working');

const results = {
  three_rows_present:       idle.length === 3,
  has_working:              !!idleWorking,
  has_idle:                 !!idleIdle,
  has_offline:              !!idleOffline,

  // Idle: all unpinned, spacing 0, transition present
  all_idle_unpinned:        idle.every(p => p.pinned === 'false'),
  all_idle_spacing_zero:    idle.every(p => near(p.spacing, 0)),
  all_have_transition:      idle.every(p => hasLetterSpacingT(p.transition)),

  // After pin click: working pinned, idle unchanged
  working_pinned_attr:      pinWorking?.pinned === 'true',
  working_spacing_half:     near(pinWorking?.spacing, 0.5),
  idle_stays_unpinned:      pinIdle?.pinned === 'false',
  idle_spacing_unchanged:   near(pinIdle?.spacing, 0),

  // After unpin click: working back to unpinned + 0 spacing
  unpin_attr_false:         unpinWorking?.pinned === 'false',
  unpin_spacing_zero:       near(unpinWorking?.spacing, 0),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend-row pin spacing:`, JSON.stringify(results),
  `\n  idle:`,     idle,
  `\n  pinned:`,   pinned,
  `\n  unpinned:`, unpinned);
process.exit(ok ? 0 : 1);
