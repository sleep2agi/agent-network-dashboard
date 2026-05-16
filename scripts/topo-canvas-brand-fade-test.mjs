/* Round 327 verification: canvas brand crescent (top-left corner,
 * codex-shipped via 1817f55 Hero 3 §3.I) joins the always-mount-
 * opacity-gate family. Pre-R327 it conditionally mounted on
 * `flowLinks.length === 0` — first flow arriving SNAP-removed it.
 * Now always-mounted with opacity={flowLinks.length === 0 ? 0.35 : 0}
 * + transition opacity 300ms ease-out so the crescent crossfades
 * in/out as the recent-signal panel state flips.
 *
 * 11th surface in the always-mount-opacity-gate idiom family
 * (R181/R182/R183/R213×2/R214/R215/R221/R222/R223/R327).
 *
 * Contract:
 *   - [data-topo-brand-canvas-mark] is present (always-mounted).
 *   - When flowLinks.length === 0 (no messages mocked): opacity=0.35
 *     + data-topo-brand-canvas-mark-visible='true'.
 *   - Computed style.transition contains 'opacity'.
 *   - R326 chrome gap-2 + R317/R318 chrome regressions intact.
 *   - R294 pulse absent.
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta') ] } });
});
// Zero messages: recent-signal panel hidden, brand crescent visible.
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-brand-canvas-mark]', { timeout: 15000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const mark = document.querySelector('[data-topo-brand-canvas-mark]');
  const chrome = document.querySelector('[data-topo-chrome]');
  return {
    markPresent:        mark !== null,
    markOpacityAttr:    mark?.getAttribute('opacity') ?? null,
    markVisibleAttr:    mark?.getAttribute('data-topo-brand-canvas-mark-visible') ?? null,
    markTransition:     mark ? getComputedStyle(mark).transition : null,
    // R326 regression: chrome strip gap-2.
    chromeGap:          chrome ? getComputedStyle(chrome).columnGap : null,
    layoutInactiveCls:  document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    layoutActiveCls:    document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount:         document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const hasOpacityTransition = (s) => /opacity\s+0?\.?\d*s|opacity\s+\d+ms/i.test(s || '');

const results = {
  mark_present:               probe.markPresent,
  mark_visible_when_empty:    probe.markVisibleAttr === 'true',
  mark_opacity_0_35:          probe.markOpacityAttr === '0.35',
  mark_has_opacity_trans:     hasOpacityTransition(probe.markTransition),
  // R326 regression.
  r326_chrome_gap_8px:        probe.chromeGap === '8px',
  // R317 / R318 chrome regression.
  r317_inactive_gray_400:     probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:    probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:          probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} canvas-brand crescent fade:`, JSON.stringify(results),
  '\n  opacity attr:', probe.markOpacityAttr,
  '\n  visible attr:', probe.markVisibleAttr,
  '\n  transition:',   probe.markTransition);
process.exit(ok ? 0 : 1);
