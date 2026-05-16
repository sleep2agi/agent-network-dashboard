/* Round 318 verification: chrome segmented-control ACTIVE button
 * gains font-medium (500) — visual weight emphasis layered on top
 * of the existing cyan-300 color + cyan-500/15 background. The
 * polish broadened across all four chrome control families that
 * share the same active-state class string:
 *   - Layout toggle (Ring / Grid) — bottom-right
 *   - nodeSize segmented (S / M / L) — bottom-right
 *   - Fullscreen toggle — top-right (single button, isFullscreen
 *     branch is its "active" state)
 *
 * Direction:  R313/R314/R315 established font-medium as the data-
 * weight chip family. R318 extends the same weight tier to chrome
 * control ACTIVE states so the currently-selected option carries
 * stronger visual prominence than just color alone.
 *
 * Contract:
 *   - The active Layout toggle button has className containing
 *     'font-medium'.
 *   - The inactive Layout toggle button does NOT have font-medium
 *     in its class string (still default 400).
 *   - Computed font-weight of active button === 500.
 *   - R317 inactive gray-400 + R316 brand-logo width=40 + R313
 *     chip-row weight + R294 pulse absent all preserved.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    // Force ring layout so Ring is the active button.
    localStorage.setItem('anet-topo-layout', 'ring');
  } catch {}
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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4'),
    mk('beta',  'gpt-4o'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-chrome-layout="ring"]', { timeout: 15000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const sel = (s) => document.querySelector(s);
  const ringBtn = sel('[data-topo-chrome-layout="ring"]');
  const gridBtn = sel('[data-topo-chrome-layout="grid"]');
  const logo = sel('[data-topo-brand-logo]');
  return {
    ringActive:    ringBtn?.getAttribute('data-topo-chrome-layout-active') === 'true',
    gridActive:    gridBtn?.getAttribute('data-topo-chrome-layout-active') === 'true',
    ringCls:       ringBtn?.className ?? '',
    gridCls:       gridBtn?.className ?? '',
    ringFw:        ringBtn ? getComputedStyle(ringBtn).fontWeight : null,
    gridFw:        gridBtn ? getComputedStyle(gridBtn).fontWeight : null,
    brandLogoW:    logo?.getAttribute('width') ?? null,
    workingChipCls: sel('[data-working-chip]')?.className ?? '',
    pulseCount:    document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const activeCls   = probe.ringActive ? probe.ringCls : probe.gridCls;
const inactiveCls = probe.ringActive ? probe.gridCls : probe.ringCls;
const activeFw    = probe.ringActive ? probe.ringFw : probe.gridFw;

const results = {
  exactly_one_active:        probe.ringActive !== probe.gridActive,
  active_has_font_medium:    activeCls.includes('font-medium'),
  inactive_no_font_medium:   !inactiveCls.includes('font-medium'),
  active_fw_500:             String(activeFw) === '500',
  // R317 regression: inactive still gray-400.
  r317_inactive_gray_400:    inactiveCls.includes('text-gray-400'),
  // R316 brand-logo width=40 regression.
  r316_brand_logo_width_40:  probe.brandLogoW === '40',
  // R313 chip-row data weight regression.
  r313_working_chip_kept:    probe.workingChipCls.includes('font-medium'),
  // R294 pulse absent regression.
  r294_pulse_absent:         probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chrome active weight:`, JSON.stringify(results),
  '\n  ring active:', probe.ringActive, ' grid active:', probe.gridActive,
  '\n  active fw:', activeFw, ' inactive fw:', probe.ringActive ? probe.gridFw : probe.ringFw);
process.exit(ok ? 0 : 1);
