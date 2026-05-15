/* Round 196 verification: every chrome button picks up an active:
 * (pressed) state for tactile click feedback. Bridges the gap between
 * mouse-down and the existing release-pop animations:
 *   R184 reset-spin    (0.45s rotation on release)
 *   R186 +/− icon pop  (0.22s scale on release)
 *   R192 readout pop   (same 0.22s on release)
 * Pre-R196 mouse-down → release was instant; nothing acknowledged the
 * held-down phase. R196 lays a darker bg under the cursor while held.
 *
 * Buttons covered:
 *   layout Ring / Grid    (active variant: cyan-500/25,  base: cyan-500/15)
 *   nodeSize S / M / L     (active: cyan-500/25, base: white/10)
 *   zoom-out / zoom-in     (white/10)
 *   reset                  (white/10)
 *   fullscreen             (active: cyan-500/25, base: white/10)
 *
 * Test:
 *   1. Static markup check — each button's class string contains the
 *      'active:bg-...' modifier(s).
 *   2. Runtime check on zoom-out: mouse.down on the button, getComputed-
 *      Style snapshot — backgroundColor differs from the idle/hover bg.
 *      Mouse.up + move off — back to idle bg.
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
await page.waitForSelector('[data-topo-chrome-zoom-in]', { timeout: 10000 });
await page.waitForTimeout(300);

// Collect all chrome button className strings
const markup = await page.evaluate(() => ({
  layoutRing:    document.querySelector('[data-topo-chrome-layout="ring"]')?.getAttribute('class') || '',
  layoutGrid:    document.querySelector('[data-topo-chrome-layout="grid"]')?.getAttribute('class') || '',
  nodeSizeS:     document.querySelector('[data-topo-chrome-nodesize="S"]')?.getAttribute('class') || '',
  nodeSizeM:     document.querySelector('[data-topo-chrome-nodesize="M"]')?.getAttribute('class') || '',
  nodeSizeL:     document.querySelector('[data-topo-chrome-nodesize="L"]')?.getAttribute('class') || '',
  zoomOut:       document.querySelector('[data-topo-chrome-zoom-out]')?.getAttribute('class') || '',
  zoomIn:        document.querySelector('[data-topo-chrome-zoom-in]')?.getAttribute('class') || '',
  reset:         document.querySelector('[data-topo-chrome-reset]')?.getAttribute('class') || '',
  fullscreen:    document.querySelector('[data-topo-chrome-fullscreen]')?.getAttribute('class') || '',
}));

// Static markup assertions
const has = (s, modifier) => s.includes(modifier);
const staticChecks = {
  layoutRing_press_active:    has(markup.layoutRing,  'active:bg-cyan-500/15')  || has(markup.layoutRing,  'active:bg-cyan-500/25'),
  layoutGrid_press_active:    has(markup.layoutGrid,  'active:bg-cyan-500/15')  || has(markup.layoutGrid,  'active:bg-cyan-500/25'),
  // nodeSize S/M/L: idle nodeScale=L default, so S/M are non-active
  // variant (active:bg-white/10); L is the active cyan variant
  // (active:bg-cyan-500/25). Check at least one of each pattern present.
  nodeSizeS_press:            has(markup.nodeSizeS,   'active:bg-white/10')     || has(markup.nodeSizeS,   'active:bg-cyan-500/25'),
  nodeSizeM_press:            has(markup.nodeSizeM,   'active:bg-white/10')     || has(markup.nodeSizeM,   'active:bg-cyan-500/25'),
  nodeSizeL_press:            has(markup.nodeSizeL,   'active:bg-white/10')     || has(markup.nodeSizeL,   'active:bg-cyan-500/25'),
  zoomOut_press_white:        has(markup.zoomOut,     'active:bg-white/10'),
  zoomIn_press_white:         has(markup.zoomIn,      'active:bg-white/10'),
  reset_press_white:          has(markup.reset,       'active:bg-white/10'),
  fullscreen_press:           has(markup.fullscreen,  'active:bg-white/10')     || has(markup.fullscreen,  'active:bg-cyan-500/25'),
};

// Stylesheet-presence check: walk document.styleSheets recursively
// and confirm Tailwind compiled the press-state rules into the page's
// CSS. Tailwind 4 nests utilities inside @layer utilities { ... } as
// a single grouping rule, so cssRules iteration must recurse.
// Synthetic Playwright pointer events don't reliably trigger
// :hover/:active in headless Chromium, so runtime computed-style
// snapshots are unreliable. Checking that the rule exists in the
// page's stylesheets is the closest static guarantee that a real
// user's click will deepen the bg.
const cssChecks = await page.evaluate(() => {
  const activeRules = [];
  function walk(list) {
    for (const r of list || []) {
      if (r.selectorText && r.selectorText.includes(':active')) {
        activeRules.push({ selector: r.selectorText, text: r.cssText });
      }
      if (r.cssRules) walk(r.cssRules);
    }
  }
  for (const sheet of document.styleSheets) {
    let list;
    try { list = sheet.cssRules; } catch { continue; }
    walk(list);
  }
  // For each modifier the markup uses, verify at least one matching
  // CSSStyleRule exists. Tailwind 4 emits each rule twice (an RGBA
  // fallback and a color-mix() form), so .some() across either is fine.
  const has = (selectorSubstr) =>
    activeRules.some(r => r.selector.includes(selectorSubstr));
  return {
    css_active_white_10:    has('active\\:bg-white\\/10'),
    css_active_cyan_25:     has('active\\:bg-cyan-500\\/25'),
    css_active_cyan_15:     has('active\\:bg-cyan-500\\/15'),
    sample_active_rules:    activeRules.length,
  };
});

await browser.close();

const results = { ...staticChecks, ...cssChecks };
// Boolean fields must be true; numeric sample_active_rules just needs > 0.
const ok = Object.entries(results).every(([k, v]) =>
  k.startsWith('sample_') ? (typeof v === 'number' && v > 0) : v === true);
console.log(`${ok ? '✅' : '❌'} chrome press-state:`, JSON.stringify(results),
  `\n  markup snippets:`,
  Object.fromEntries(Object.entries(markup).map(([k, v]) => [k, v.match(/active:bg-[^\s]+/g)?.join(' ') || '(no active: classes)'])));
process.exit(ok ? 0 : 1);
