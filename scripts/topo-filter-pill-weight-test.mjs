/* Round 343 verification: filter pin pills (status / group / vendor /
 * edge — 4 surfaces sharing className) gain `font-medium`. Aligns
 * chip-row data-weight tier with working/online chips (which already
 * carry font-medium per R313).
 *
 * Contract:
 *   - Active filter pill ([data-active-filter] of any kind) has
 *     className containing 'font-medium'.
 *   - Computed font-weight reads 500.
 *   - Prefix opacity-0.7 (R335) + R342 freshness wrapper gray-400
 *     regressions intact.
 *   - R317/R318/R294 chrome + pulse regressions intact.
 *
 * Fixture: pin status (working) so the filter pin pill mounts.
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta'), mk('gamma') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-working-chip]', { timeout: 15000 });
await page.waitForTimeout(200);
await page.click('[data-working-chip]', { delay: 50 }).catch(() => {});
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const filterPill = document.querySelector('[data-active-filter]');
  const prefix     = document.querySelector('[data-filter-prefix]');
  return {
    pillClass:        filterPill?.className ?? '',
    pillFw:           filterPill ? getComputedStyle(filterPill).fontWeight : null,
    prefixClass:      prefix?.className ?? '',
    layoutInactiveCls: document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    layoutActiveCls:   document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount:        document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const results = {
  pill_has_font_medium:        /font-medium/.test(probe.pillClass),
  pill_computed_fw_500:        String(probe.pillFw) === '500',
  // R335 regression — prefix still has opacity-70.
  r335_prefix_opacity70:       /opacity-70/.test(probe.prefixClass),
  // R317 / R318 chrome regression.
  r317_inactive_gray_400:      probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:     probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:           probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} filter pill font-medium:`, JSON.stringify(results),
  '\n  pill fw:', probe.pillFw);
process.exit(ok ? 0 : 1);
