/* Round 234 verification: vendor letter chip (the inline chips
 * showing 'A:3', 'C:2', etc. listing per-vendor session counts)
 * picks up the Tailwind `tabular-nums` utility so its ':N' suffix
 * digit doesn't reflow the chip row at the 9→10 boundary.
 *
 * 8th surface in the info-density tabular-nums sweep, completing
 * the HTML chip-side after R232's working/online/active-links.
 *
 * Scenario: 4 working agents split across two vendors — 3 on
 * claude-opus-4 (initial 'A') and 1 on gpt-4 (initial 'O') — so
 * vendorDist.length === 2, which is the condition gating the
 * chip strip render (line ~2116, `vendorDist.length > 1 && ...`).
 * Expect two chips: A:3 and O:1.
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
  const mk = (alias, model) => ({
    alias, status: 'working', model, runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // Mix 3 claude-opus-4 (vendor 'A') + 1 gpt-4 (vendor 'O') so
  // vendorDist.length === 2 — chip strip render gate (line ~2116).
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4'),
    mk('beta',  'claude-opus-4'),
    mk('gamma', 'claude-opus-4'),
    mk('delta', 'gpt-4'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-vendor-letter]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

const out = await page.evaluate(() => {
  const chips = Array.from(document.querySelectorAll('[data-vendor-letter]'));
  return chips.map((c) => ({
    initial:         c.getAttribute('data-vendor-letter'),
    countAttr:       c.getAttribute('data-vendor-letter-count'),
    classListHas:    c.className.split(/\s+/).includes('tabular-nums'),
    fontVarNumeric:  getComputedStyle(c).fontVariantNumeric,
    text:            (c.textContent || '').trim(),
    // Inner ':N' suffix span — verify font-variant-numeric inherits
    innerFvn:        (() => {
      const inner = c.querySelectorAll('span');
      // last span is the gray ':N' suffix
      const last = inner[inner.length - 1];
      return last ? getComputedStyle(last).fontVariantNumeric : null;
    })(),
  }));
});
await browser.close();

const hasTab = (s) => /tabular-nums/.test(s || '');

// Build a map of initial → count from the chips we found.
const countByInitial = Object.fromEntries(out.map(o => [o.initial, o.countAttr]));
const results = {
  two_chips:               out.length === 2,
  all_have_initial:        out.every(o => typeof o.initial === 'string' && o.initial.length === 1),
  anthropic_count_3:       countByInitial['A'] === '3',
  openai_count_1:          countByInitial['O'] === '1',
  all_class_utility:       out.every(o => o.classListHas === true),
  all_fvn_tabular:         out.every(o => hasTab(o.fontVarNumeric)),
  all_inner_fvn_inherits:  out.every(o => hasTab(o.innerFvn)),
  texts_match_counts:      out.every(o => new RegExp(`:${o.countAttr}$`).test(o.text)),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} vendor chip tabular:`, JSON.stringify(results),
  '\n  chips:', out);
process.exit(ok ? 0 : 1);
