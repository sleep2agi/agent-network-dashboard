/* Round 235 verification: pin-intersection chip (the
 * '{pinDimCount} pins · {matchAliases.length}' chip that surfaces
 * when multiple filter dimensions are pinned simultaneously) picks
 * up the Tailwind `tabular-nums` utility so its two visible
 * digits don't reflow the chip on counter changes.
 *
 * 9th surface in the info-density tabular-nums sweep — the third
 * HTML chip surface, completing chip-row + vendor-row + pin-
 * intersection chip coverage.
 *
 * Scenario: needs >= 2 pinned filter dimensions to trigger the
 * chip render. Simplest path: 4 sessions split across two
 * vendors (anthropic + openai) and two statuses (working +
 * idle). Then in the page we set pinnedStatus + pinnedVendor
 * via localStorage so two filter dims pin simultaneously
 * without needing to click the chips.
 *
 * The TopoGraph reads pinnedStatus + pinnedVendor from session-
 * Storage keys (R88 / R60 persistence — let me trust that's
 * how the state hydrates from storage at mount). If not, fall
 * back to programmatic click on the working chip + vendor letter.
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
  const mk = (alias, model, status) => ({
    alias, status, model, runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // 2 vendors × 2 statuses so multiple filter dims have something
  // to bite on (chip strip renders, pressure-bar segments populate).
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4', 'working'),
    mk('beta',  'claude-opus-4', 'idle'),
    mk('gamma', 'gpt-4',         'working'),
    mk('delta', 'gpt-4',         'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-vendor-letter]', { timeout: 10000, state: 'attached' });

// Pin two filter dimensions: click the working pressure-bar segment
// + click the anthropic vendor letter. Both should fire setPinned*
// state which surfaces the pin-intersection chip.
await page.locator('[data-pressure-seg="working"]').first().click();
await page.locator('[data-vendor-letter="A"]').first().click();
await page.waitForSelector('[data-pin-intersection]', { timeout: 5000, state: 'attached' });
await page.waitForTimeout(300);

const out = await page.evaluate(() => {
  const chip = document.querySelector('[data-pin-intersection]');
  if (!chip) return null;
  return {
    pinDim:          chip.getAttribute('data-pin-dim-count'),
    matchCount:      chip.getAttribute('data-pin-intersection-count'),
    empty:           chip.getAttribute('data-pin-intersection-empty'),
    classListHas:    chip.className.split(/\s+/).includes('tabular-nums'),
    fontVarNumeric:  getComputedStyle(chip).fontVariantNumeric,
    text:            (chip.textContent || '').trim(),
  };
});
await browser.close();

const hasTab = (s) => /tabular-nums/.test(s || '');

const results = {
  chip_mounted:           out !== null,
  pin_dim_2:              out?.pinDim === '2',
  match_present:          typeof out?.matchCount === 'string' && /^\d+$/.test(out.matchCount),
  empty_attr_present:     out?.empty === 'true' || out?.empty === 'false',
  class_utility_present:  out?.classListHas === true,
  fvn_tabular_nums:       hasTab(out?.fontVarNumeric),
  text_has_pins_dot:      /\d+\s*pins?\s*·\s*\d+/.test(out?.text || ''),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} pin-intersection tabular:`, JSON.stringify(results),
  '\n  chip:', out);
process.exit(ok ? 0 : 1);
