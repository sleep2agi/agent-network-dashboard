/* Round 163 verification: Ring/Grid layout toggle buttons pick
 * up the R154 chrome-button polish convention.
 *
 * Pre-R163 the buttons had aria-pressed + transition-colors but:
 *   - no focus-visible ring (browser default invisible on canvas)
 *   - inactive hover only nudged text-gray-500 → gray-400, no bg
 *
 * R163 adds:
 *   data-topo-chrome-layout="ring|grid"
 *   data-topo-chrome-layout-active="true|false"
 *   focus-visible:ring-2 ring-cyan-400/60 ring-inset
 *   inactive: hover:text-gray-300 + hover:bg-cyan-500/5
 *   active:   hover:bg-cyan-500/20 (slightly hotter)
 *
 * Test:
 *   1. Both buttons present with data-topo-chrome-layout attr
 *   2. Active button has bg-cyan-500/15 class fragment (existing)
 *   3. Focus the inactive button → focus-visible ring class fragment
 *   4. Hover the inactive button → bg color shifts from transparent
 *      to a cyan-ish tint (border bg-cyan-500/5)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); localStorage.setItem('anet-topo-layout', 'ring'); } catch {}
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
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta')] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 2, { timeout: 30000 });
await page.waitForSelector('[data-topo-chrome-layout]', { timeout: 10000 });
await page.waitForTimeout(400);

// Probe basic attrs & class membership
const probe = await page.evaluate(() => {
  const ring = document.querySelector('[data-topo-chrome-layout="ring"]');
  const grid = document.querySelector('[data-topo-chrome-layout="grid"]');
  if (!ring || !grid) return null;
  return {
    ring_active:    ring.getAttribute('data-topo-chrome-layout-active'),
    grid_active:    grid.getAttribute('data-topo-chrome-layout-active'),
    ring_pressed:   ring.getAttribute('aria-pressed'),
    grid_pressed:   grid.getAttribute('aria-pressed'),
    ring_class:     ring.getAttribute('class') || '',
    grid_class:     grid.getAttribute('class') || '',
  };
});

// Focus the inactive (grid) button — focus-visible ring should kick in.
// Tab-focus produces the :focus-visible state; .focus() doesn't always.
// Use page.keyboard.press('Tab') after first focusing somewhere known.
await page.locator('[data-topo-chrome-layout="grid"]').focus();
// trigger keyboard navigation to enable focus-visible state heuristic
await page.evaluate(() => {
  const el = document.querySelector('[data-topo-chrome-layout="grid"]');
  if (el) el.matches(':focus-visible');
});
const focusVisibleProbe = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-chrome-layout="grid"]');
  if (!el) return null;
  return {
    isActiveElement: document.activeElement === el,
    // Inspect outline & box-shadow because the Tailwind focus-visible:ring
    // class compiles to a box-shadow. After .focus() Chromium reports
    // :focus-visible heuristically — we verify the class fragment exists
    // in the stylesheet bound to this element rather than relying on the
    // dynamic pseudo-class match.
    classFragments: {
      hasFocusVisibleRingClass: (el.getAttribute('class') || '').includes('focus-visible:ring-cyan-400/60'),
      hasRingInset:             (el.getAttribute('class') || '').includes('focus-visible:ring-inset'),
      hasFocusOutlineNone:      (el.getAttribute('class') || '').includes('focus:outline-none'),
    },
  };
});

// Hover the inactive (grid) button — bg should shift away from transparent.
const gridBgBefore = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-chrome-layout="grid"]');
  return el ? getComputedStyle(el).backgroundColor : null;
});
await page.locator('[data-topo-chrome-layout="grid"]').hover();
await page.waitForTimeout(300);
const gridBgHover = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-chrome-layout="grid"]');
  return el ? getComputedStyle(el).backgroundColor : null;
});

await browser.close();

const results = {
  both_buttons_found:        probe !== null,
  ring_is_active:            probe?.ring_active === 'true',
  grid_is_inactive:          probe?.grid_active === 'false',
  ring_aria_pressed:         probe?.ring_pressed === 'true',
  grid_aria_unpressed:       probe?.grid_pressed === 'false',
  active_has_cyan_bg_class:  probe?.ring_class.includes('bg-cyan-500/15'),
  inactive_hover_bg_class:   probe?.grid_class.includes('hover:bg-cyan-500/5'),
  active_hover_bg_class:     probe?.ring_class.includes('hover:bg-cyan-500/20'),
  focus_outline_none:        focusVisibleProbe?.classFragments?.hasFocusOutlineNone === true,
  focus_visible_ring_class:  focusVisibleProbe?.classFragments?.hasFocusVisibleRingClass === true,
  focus_visible_ring_inset:  focusVisibleProbe?.classFragments?.hasRingInset === true,
  inactive_bg_before:        gridBgBefore !== null,
  hover_changes_bg:          gridBgBefore !== gridBgHover,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} layout toggle polish:`, JSON.stringify(results),
  `\n  probe=`, probe,
  `\n  focus=`, focusVisibleProbe,
  `\n  bg before/hover=`, gridBgBefore, '→', gridBgHover);
process.exit(ok ? 0 : 1);
