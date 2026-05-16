/* Round 317 verification: chrome strip Layout toggle inactive text
 * color from `text-gray-500` → `text-gray-400`. Same R296 direction
 * (kicker 600→500) extended to chrome control inactive text — more
 * visible but still subordinate to active cyan-300.
 *
 * Contract:
 *   - [data-topo-chrome-layout='ring'] when INACTIVE has className
 *     containing 'text-gray-400' (not 'text-gray-500').
 *   - [data-topo-chrome-layout='grid'] same when inactive.
 *   - At least one of Ring/Grid is inactive (only one is layout-
 *     active at a time).
 *   - R316 brand-logo width=40 + R315 freshness chip + R313/R314
 *     chip-row data weight + R294 pulse absent all preserved.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  // Force ring layout so grid will be inactive.
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
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
    brandLogoW:    logo?.getAttribute('width') ?? null,
    workingChipCls: sel('[data-working-chip]')?.className ?? '',
    pulseCount:    document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

// The inactive button should have gray-400 (not gray-500). The
// active button uses text-cyan-300 (no gray class), so checking
// 'text-gray-400' is meaningful only for inactive.
const inactiveCls = probe.ringActive ? probe.gridCls : probe.ringCls;
const activeCls   = probe.ringActive ? probe.ringCls : probe.gridCls;

const results = {
  exactly_one_active:        probe.ringActive !== probe.gridActive,
  inactive_has_gray_400:     inactiveCls.includes('text-gray-400'),
  inactive_no_gray_500:      !inactiveCls.includes('text-gray-500'),
  active_has_cyan_300:       activeCls.includes('text-cyan-300'),
  r316_brand_logo_width_40:  probe.brandLogoW === '40',
  r313_working_chip_kept:    probe.workingChipCls.includes('font-medium'),
  r294_pulse_absent:         probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chrome inactive color:`, JSON.stringify(results),
  '\n  ring active:', probe.ringActive, ' grid active:', probe.gridActive,
  '\n  inactive cls subset:', inactiveCls.match(/text-(gray|cyan)-\d+/g),
  '\n  active cls subset:', activeCls.match(/text-(gray|cyan)-\d+/g));
process.exit(ok ? 0 : 1);
