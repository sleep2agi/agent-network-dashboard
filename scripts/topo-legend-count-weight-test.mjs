/* Round 309 verification: legend per-row count gains fontWeight=600
 * (semibold). The count is the DATA in each row; semibold gives it
 * glanceable priority over the default-weight row label.
 *
 * Contract:
 *   - [data-legend-count='working'] attr font-weight === '600'.
 *   - [data-legend-count='idle']    attr font-weight === '600'.
 *   - [data-legend-count='offline'] attr font-weight === '600'.
 *   - All three preserve tabular-nums (R274 family).
 *   - R308 row labels still 'working' / 'idle' / 'offline'.
 *   - R306 chrome focus-ring-1 + R304 sub-hint + R294 pulse intact.
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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4', 'working'),
    mk('beta',  'gpt-4o',        'idle'),
    mk('gamma', 'claude-sonnet-4', 'offline'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-legend-count="working"]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const sel = (s) => document.querySelector(s);
  const working = sel('[data-legend-count="working"]');
  const idle    = sel('[data-legend-count="idle"]');
  const offline = sel('[data-legend-count="offline"]');
  const fvn = (el) => el ? getComputedStyle(el).fontVariantNumeric : null;
  return {
    workingFw:  working?.getAttribute('font-weight') ?? null,
    idleFw:     idle?.getAttribute('font-weight') ?? null,
    offlineFw:  offline?.getAttribute('font-weight') ?? null,
    workingFvn: fvn(working),
    workingLabel: sel('[data-legend-row-label="working"]')?.textContent?.trim() ?? null,
    idleLabel:    sel('[data-legend-row-label="idle"]')?.textContent?.trim() ?? null,
    offlineLabel: sel('[data-legend-row-label="offline"]')?.textContent?.trim() ?? null,
    layoutRingCls: sel('[data-topo-chrome-layout="ring"]')?.className ?? '',
    subhintLs:    sel('[data-recent-signal-empty-hint]')?.getAttribute('letter-spacing') ?? null,
    pulseCount:   document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const hasTab = (s) => /tabular-nums/.test(s || '');

const results = {
  working_count_fw_600:   probe.workingFw === '600',
  idle_count_fw_600:      probe.idleFw === '600',
  offline_count_fw_600:   probe.offlineFw === '600',
  count_tabular_kept:     hasTab(probe.workingFvn),
  r308_working_label:     probe.workingLabel === 'working',
  r308_idle_label:        probe.idleLabel === 'idle',
  r307_offline_label:     probe.offlineLabel === 'offline',
  r306_focus_ring_1:      probe.layoutRingCls.includes('focus-visible:ring-1'),
  r304_subhint_ls_0_15:   probe.subhintLs === '0.15',
  r294_pulse_absent:      probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend count weight:`, JSON.stringify(results),
  '\n  counts fw:', probe.workingFw, '/', probe.idleFw, '/', probe.offlineFw,
  '\n  labels:', probe.workingLabel, '/', probe.idleLabel, '/', probe.offlineLabel);
process.exit(ok ? 0 : 1);
