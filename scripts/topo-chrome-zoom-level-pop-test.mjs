/* Round 192 verification: the zoom-level readout span (the "%" text
 * between + and − buttons) participates in the R186 click-feel pop
 * alongside the icons.
 *
 * Pre-R192 only the + / − icons popped on click; the readout text
 * itself snapped from one value to another with no acknowledgement.
 * R192 splices the existing .anet-chrome-pop class onto the readout
 * span while chromePopping is 'zoom-in' or 'zoom-out' (set by the
 * shared popChrome flag the icons already use).
 *
 * Test:
 *   1. Default state — readout has data-topo-chrome-zoom-level-popping
 *      = 'false', no 'anet-chrome-pop' in className.
 *   2. Click zoom-in: capture the readout className within ~120ms.
 *      Should have 'anet-chrome-pop' + data-popping='true'.
 *   3. Wait past the 240ms class clear: readout className back to
 *      base, data-popping='false'.
 *   4. Click zoom-out: same pop activation flips on then back off.
 *   5. Display rule: span must NOT be 'inline' so the transform:
 *      scale() from the keyframe actually renders. (Inline style
 *      sets display:'inline-block' for that reason — but the parent
 *      <div class="flex"> blockifies it to 'block' in computed
 *      style, which is fine for transforms either way.)
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
await page.waitForSelector('[data-topo-chrome-zoom-level]', { timeout: 10000 });
await page.waitForTimeout(300);

const readSpan = async () => page.evaluate(() => {
  const el = document.querySelector('[data-topo-chrome-zoom-level]');
  if (!el) return null;
  return {
    className: el.getAttribute('class') || '',
    popping:   el.getAttribute('data-topo-chrome-zoom-level-popping'),
    display:   getComputedStyle(el).display,
    text:      el.textContent?.trim() || '',
  };
});

const idle = await readSpan();

// Click zoom-in and snapshot quickly
await page.click('[data-topo-chrome-zoom-in]');
await page.waitForTimeout(80);  // well inside the 240ms class window
const popped = await readSpan();

// Wait past the popChrome clear (~260ms total)
await page.waitForTimeout(280);
const settled = await readSpan();

// Click zoom-out and snapshot quickly
await page.click('[data-topo-chrome-zoom-out]');
await page.waitForTimeout(80);
const poppedOut = await readSpan();

await page.waitForTimeout(280);
const settled2 = await readSpan();

await browser.close();

const has = (s, c) => (s?.className || '').split(/\s+/).includes(c);

const results = {
  idle_no_pop_class:        !has(idle, 'anet-chrome-pop'),
  idle_popping_false:       idle?.popping === 'false',
  idle_has_base_classes:    /tabular-nums/.test(idle?.className || '') && /border-x/.test(idle?.className || ''),
  display_not_inline:       idle?.display !== 'inline',

  popped_has_pop_class:     has(popped, 'anet-chrome-pop'),
  popped_popping_true:      popped?.popping === 'true',
  popped_keeps_base:        /tabular-nums/.test(popped?.className || ''),

  settled_no_pop_class:     !has(settled, 'anet-chrome-pop'),
  settled_popping_false:    settled?.popping === 'false',

  poppedOut_has_pop_class:  has(poppedOut, 'anet-chrome-pop'),
  poppedOut_popping_true:   poppedOut?.popping === 'true',

  settled2_no_pop_class:    !has(settled2, 'anet-chrome-pop'),
  settled2_popping_false:   settled2?.popping === 'false',

  text_shows_percent:       /^\d+%$/.test(idle?.text || ''),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chrome zoom-level pop:`, JSON.stringify(results),
  `\n  idle:`,    idle,
  `\n  popped:`,  popped,
  `\n  settled:`, settled,
  `\n  poppedOut:`, poppedOut,
  `\n  settled2:`, settled2);
process.exit(ok ? 0 : 1);
