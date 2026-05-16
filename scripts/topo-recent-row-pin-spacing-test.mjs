/* Round 220 verification (milestone): recent-signal row text completes
 * the pin-signature typography triple (R218 group labels / R219
 * legend rows / R220 recent-signal rows). All three label-based
 * interactive surfaces now read "locked in" at type level on pin.
 *
 * Test (cyber dark, 4 working sessions + 3 mock flows so recent-
 * signal panel renders 3 rows):
 *   1. 3 [data-recent-row-text] rows render.
 *   2. Idle: all pinned='false', spacing 'normal' or 0px.
 *   3. Inline transition includes 'letter-spacing 150ms'.
 *   4. Click first row to pin it.
 *   5. First row: pinned='true', spacing ≈ 0.5px.
 *   6. Other rows stay unpinned + 0 spacing.
 *   7. Click pinned row again → unpin → back to 0.
 *   8. Hover (not pin) does NOT trigger letter-spacing spread —
 *      pin-exclusive signature (proven by hover-without-click test).
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

const now = Date.now();
const msgs = [
  { id: '1', from_alias: 'alpha', to_alias: 'beta',  content: 'hi',
    network_id: 'default', created_at: new Date(now - 2000).toISOString() },
  { id: '2', from_alias: 'beta',  to_alias: 'gamma', content: 'hi',
    network_id: 'default', created_at: new Date(now - 5000).toISOString() },
  { id: '3', from_alias: 'gamma', to_alias: 'delta', content: 'hi',
    network_id: 'default', created_at: new Date(now - 8000).toISOString() },
];
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-recent-row-text]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

const probe = async () => page.evaluate(() => {
  return [...document.querySelectorAll('[data-recent-row-text]')].map(el => {
    const cs = getComputedStyle(el);
    return {
      key:         el.getAttribute('data-recent-row-text'),
      pinned:      el.getAttribute('data-recent-row-text-pinned'),
      spacing:     cs.letterSpacing,
      transition:  el.style.transition,
    };
  });
});

const idle = await probe();
const firstKey = idle[0]?.key;

// Hover-without-pin probe: hover the first row, verify spacing
// stays at 0 (pin-exclusive signature, not triggered by hover)
await page.hover(`[data-recent-row="${firstKey}"]`);
await page.waitForTimeout(200);
const hovered = await probe();
await page.mouse.move(0, 0);
await page.waitForTimeout(180);

// Click to pin
await page.click(`[data-recent-row="${firstKey}"]`);
await page.waitForTimeout(200);
const pinned = await probe();

// Click again to unpin
await page.click(`[data-recent-row="${firstKey}"]`);
await page.waitForTimeout(200);
const unpinned = await probe();

await browser.close();

const near = (s, want, tol = 0.15) => {
  if (want === 0 && (s === 'normal' || s === '0px' || s === '0' || !s)) return true;
  const got = parseFloat(s || '0');
  return Math.abs(got - want) < tol;
};
const hasLetterSpacingT = (s) => /letter-spacing\s+(?:150ms|0\.15s)/.test(s || '');

const firstIdle    = idle.find(p => p.key === firstKey);
const firstHovered = hovered.find(p => p.key === firstKey);
const firstPinned  = pinned.find(p => p.key === firstKey);
const otherPinned  = pinned.find(p => p.key !== firstKey);
const firstUnpin   = unpinned.find(p => p.key === firstKey);

const results = {
  three_rows_present:       idle.length === 3,
  all_idle_unpinned:        idle.every(p => p.pinned === 'false'),
  all_idle_spacing_zero:    idle.every(p => near(p.spacing, 0)),
  all_have_transition:      idle.every(p => hasLetterSpacingT(p.transition)),

  // Pin-exclusive: hover does NOT trigger letter-spacing spread
  hovered_pinned_false:     firstHovered?.pinned === 'false',
  hovered_spacing_zero:     near(firstHovered?.spacing, 0),

  // Pin click triggers spread
  first_pinned_attr:        firstPinned?.pinned === 'true',
  first_pinned_spacing:     near(firstPinned?.spacing, 0.5),
  other_stays_unpinned:     otherPinned?.pinned === 'false',
  other_spacing_unchanged:  near(otherPinned?.spacing, 0),

  // Unpin returns to 0
  unpin_attr_false:         firstUnpin?.pinned === 'false',
  unpin_spacing_zero:       near(firstUnpin?.spacing, 0),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row pin spacing:`, JSON.stringify(results),
  `\n  idle:`,    idle,
  `\n  hovered:`, hovered,
  `\n  pinned:`,  pinned,
  `\n  unpinned:`,unpinned);
process.exit(ok ? 0 : 1);
