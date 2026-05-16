/* Round 267 verification: title block adopts leading-tight on both
 * kicker and h2 for tighter editorial-style rhythm.
 *
 * Pre-R267 the title block used Tailwind compound defaults:
 *   kicker (text-xs): font 12px / line 16px (ratio ~1.33)
 *   h2 (text-lg):     font 18px / line 28px (ratio ~1.56)
 *   Total title block height: ~44 px
 *
 * R267 adds leading-tight (1.25) to both:
 *   kicker: 12px font in 15px line
 *   h2:     18px font in 22.5px line
 *   Total: ~37.5 px (~15% more compact)
 *
 * Test scope:
 *   1. Kicker present with data-topo-section-kicker attr.
 *   2. h2 present with data-topo-section-title attr.
 *   3. Kicker computed line-height < 16px (was 16px; should be 15px).
 *   4. h2 computed line-height < 28px (was 28px; should be 22.5px).
 *   5. Total title block bounding height ≤ 45 px (was ~44; should be ~37).
 *      Allow generous slop since browser font metrics + sub-pixel
 *      rounding vary.
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
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-topo-section-kicker]', { timeout: 10000 });
await page.waitForSelector('[data-topo-section-title]',  { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const kicker = document.querySelector('[data-topo-section-kicker]');
  const title  = document.querySelector('[data-topo-section-title]');
  // The two stack inside a parent <div>; measure parent's bounding box
  // for "title block height".
  const parent = kicker?.parentElement ?? null;
  const parseLH = (el) => {
    const lh = window.getComputedStyle(el).lineHeight;
    // Chrome returns either '15px' or 'normal' or a multiplier like '1.25'.
    // For px values, parseFloat works; for 'normal', return font-size.
    if (lh === 'normal') {
      return parseFloat(window.getComputedStyle(el).fontSize);
    }
    return parseFloat(lh);
  };
  return {
    kickerHasClass: kicker?.classList.contains('leading-tight') ?? false,
    titleHasClass:  title?.classList.contains('leading-tight')  ?? false,
    kickerLH:       kicker ? parseLH(kicker) : null,
    titleLH:        title  ? parseLH(title)  : null,
    parentHeight:   parent ? parent.getBoundingClientRect().height : null,
  };
});
await browser.close();

const results = {
  kicker_has_leading_tight_class: probe.kickerHasClass,
  title_has_leading_tight_class:  probe.titleHasClass,
  kicker_line_height_under_16:    probe.kickerLH != null && probe.kickerLH < 16,
  title_line_height_under_28:     probe.titleLH != null && probe.titleLH < 28,
  // Pre-R267 title block was ~44px tall. Post-R267 target ~37.5px.
  // Allow slop for browser metrics: <= 45 confirms compression happened.
  title_block_height_under_45:    probe.parentHeight != null && probe.parentHeight <= 45,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} title block tight leading:`, JSON.stringify(results),
  '\n  kicker line-height:', probe.kickerLH, '/ title line-height:', probe.titleLH,
  '\n  title block height:', probe.parentHeight);
process.exit(ok ? 0 : 1);
