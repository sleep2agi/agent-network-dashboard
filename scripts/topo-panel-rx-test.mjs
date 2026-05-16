/* Round 331 verification: SVG panel rects (recent-signal + legend)
 * rx 8 → 10 for proportional corner-radius rhythm under R330's
 * rounded-xl (12 px) canvas wrapper.
 *
 * Size-hierarchy gradient now:
 *   outer wrapper      rounded-xl   12 px  (R330)
 *   inner SVG panels   rx=10        10 px  (R331, this round)
 *   inner detail card  rx=8          8 px  (codex 8f981a9)
 *   node label card    rx=6          6 px  (legacy R63)
 *
 * Contract:
 *   - Both [data-topo-panel="recent"] and [data-topo-panel="legend"]
 *     have a child <rect> with rx="10".
 *   - R330 wrapper still rounded-xl (12px).
 *   - R317 / R318 / R294 chrome + pulse regressions intact.
 *   - topo-overlap-test ZERO OVERLAP separately verified (rx changes
 *     paint only, not bbox).
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
// Recent panel renders only when flowLinks > 0 (codex R310/§3.C
// hide-when-empty). Provide a single flow so it mounts.
const now = Date.now();
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'alpha', to_alias: 'beta', content: 'ping',
    network_id: 'default', created_at: new Date(now - 5000).toISOString() },
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-panel="recent"]', { timeout: 15000 });
await page.waitForSelector('[data-topo-panel="legend"]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const recent = document.querySelector('[data-topo-panel="recent"]');
  const legend = document.querySelector('[data-topo-panel="legend"]');
  const recentRect = recent?.querySelector('rect');
  const legendRect = legend?.querySelector('rect');
  const wrapper = document.querySelector('[data-topo-wrapper]');
  return {
    recentRx:           recentRect?.getAttribute('rx') ?? null,
    legendRx:           legendRect?.getAttribute('rx') ?? null,
    wrapperClass:       wrapper?.className ?? '',
    wrapperRadius:      wrapper ? getComputedStyle(wrapper).borderTopLeftRadius : null,
    layoutInactiveCls:  document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    layoutActiveCls:    document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount:         document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const results = {
  recent_panel_rx_10:       probe.recentRx === '10',
  legend_panel_rx_10:       probe.legendRx === '10',
  // R330 regression — wrapper still rounded-xl.
  r330_wrapper_rounded_xl:  probe.wrapperClass.includes('rounded-xl'),
  r330_wrapper_radius_12px: probe.wrapperRadius === '12px',
  // R317 / R318 chrome regression.
  r317_inactive_gray_400:   probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:  probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:        probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} panel rx 10:`, JSON.stringify(results),
  '\n  recent rx:', probe.recentRx,
  '\n  legend rx:', probe.legendRx,
  '\n  wrapper radius:', probe.wrapperRadius);
process.exit(ok ? 0 : 1);
