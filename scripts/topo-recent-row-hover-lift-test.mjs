/* Round 143 verification: recent-signal panel rows lift 1px on
 * hover or pin. Closes the "interactive surface elevates" idiom
 * across four nested canvas-region scopes:
 *   R51  node hover-lift (canvas element)        → translateY(-2px)
 *   R135 overlay panels (canvas chrome)          → drop-shadow boost
 *   R142 group boxes (canvas-side per-team)      → drop-shadow filter
 *   R143 recent-signal rows (panel content)      → translateY(-1px)
 *
 * Smaller layer = smaller lift (1px row, 2px node, drop-shadow
 * panel/box). Each layer signals interactivity in its own
 * vocabulary.
 *
 * States:
 *   1. Idle row: data-recent-row-lifted="false", no transform
 *   2. Hover row → lifted=true, transform contains translateY(-1px)
 *   3. Leave hover → restored to flat
 *   4. Click to pin → lifted=true (pin keeps the lift)
 *   5. Esc → cleared back to flat
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
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
    mk('alpha', 'working'), mk('beta', 'working'), mk('gamma', 'idle'),
  ] } });
});

const now = Date.now();
const msgs = [];
// 3 distinct pairs → 3 recent-signal rows
const pairs = [['alpha', 'beta'], ['beta', 'gamma'], ['gamma', 'alpha']];
pairs.forEach(([from, to], i) => {
  msgs.push({
    id: `m${i}`,
    from_alias: from,
    to_alias: to,
    content: 'hi',
    network_id: 'default',
    created_at: new Date(now - (20000 + i * 1000)).toISOString(),
  });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-recent-row="alpha->beta"]', { timeout: 10000 });
await page.waitForTimeout(400);

const inspect = (key) => page.evaluate((k) => {
  const row = document.querySelector(`[data-recent-row="${k}"]`);
  return {
    lifted:    row?.getAttribute('data-recent-row-lifted'),
    hovered:   row?.getAttribute('data-recent-row-hovered'),
    pinned:    row?.getAttribute('data-recent-row-pinned'),
    transform: row?.getAttribute('style')?.match(/translateY\([^)]+\)/)?.[0],
  };
}, key);

// State 1: idle baseline (no hover, no pin)
const s1 = await inspect('alpha->beta');

// State 2: hover alpha->beta row
await page.locator('[data-recent-row="alpha->beta"]').hover();
await page.waitForTimeout(250);
const s2_hovered = await inspect('alpha->beta');
const s2_other   = await inspect('beta->gamma');

// State 3: leave hover (mouse far away to clear all panel hovers)
await page.mouse.move(700, 350);
await page.waitForTimeout(250);
const s3 = await inspect('alpha->beta');

// State 4: click row to pin
await page.locator('[data-recent-row="alpha->beta"]').click();
await page.waitForTimeout(250);
// Move mouse away so only pin lifts the row (not hover)
await page.mouse.move(700, 350);
await page.waitForTimeout(250);
const s4 = await inspect('alpha->beta');

// State 5: Esc clears pin
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
const s5 = await inspect('alpha->beta');

await browser.close();

const liftStr = 'translateY(-1px)';
const results = {
  s1_idleFlat:            s1.lifted === 'false' && !s1.transform,

  s2_hoveredLifted:       s2_hovered.hovered === 'true' && s2_hovered.lifted === 'true',
  s2_hoveredTransform:    s2_hovered.transform === liftStr,
  s2_otherStillFlat:      s2_other.lifted === 'false' && !s2_other.transform,

  s3_restored:            s3.lifted === 'false' && !s3.transform,

  s4_pinnedLifted:        s4.pinned === 'true' && s4.lifted === 'true',
  s4_pinnedTransform:     s4.transform === liftStr,

  s5_clearedAfterEsc:     s5.lifted === 'false' && !s5.transform,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row hover lift:`, JSON.stringify(results),
  `\n  s1=`, s1, `\n  s2_hovered=`, s2_hovered, ` s2_other=`, s2_other,
  `\n  s3=`, s3, `\n  s4=`, s4, `\n  s5=`, s5);
process.exit(ok ? 0 : 1);
