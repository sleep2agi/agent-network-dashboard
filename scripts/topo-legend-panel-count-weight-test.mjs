/* Round 310 verification: legend panel-header count 'N nodes' gains
 * fontWeight=600 for parity with R309 per-row count weight. Same
 * "digit semibold > label regular" hierarchy applied to the panel-
 * summary scope.
 *
 * Contract:
 *   - [data-legend-panel-count] attr font-weight === '600'.
 *   - Text content matches '{N} node[s]' pattern.
 *   - R266 fill transition + R292 tabular-nums preserved.
 *   - R309 per-row counts still font-weight='600' (regression).
 *   - R308 row labels + R307 offline label + R306 chrome focus-ring-1
 *     + R304 sub-hint + R294 pulse all preserved.
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
await page.waitForSelector('[data-legend-panel-count]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const sel = (s) => document.querySelector(s);
  const panelCount = sel('[data-legend-panel-count]');
  const fvn = (el) => el ? getComputedStyle(el).fontVariantNumeric : null;
  return {
    panelCountFw:   panelCount?.getAttribute('font-weight') ?? null,
    panelCountText: panelCount?.textContent?.trim() ?? null,
    panelCountFvn:  fvn(panelCount),
    rowCountWorkingFw: sel('[data-legend-count="working"]')?.getAttribute('font-weight') ?? null,
    rowCountIdleFw:    sel('[data-legend-count="idle"]')?.getAttribute('font-weight') ?? null,
    rowCountOfflineFw: sel('[data-legend-count="offline"]')?.getAttribute('font-weight') ?? null,
    workingLabel:   sel('[data-legend-row-label="working"]')?.textContent?.trim() ?? null,
    idleLabel:      sel('[data-legend-row-label="idle"]')?.textContent?.trim() ?? null,
    offlineLabel:   sel('[data-legend-row-label="offline"]')?.textContent?.trim() ?? null,
    layoutRingCls:  sel('[data-topo-chrome-layout="ring"]')?.className ?? '',
    subhintLs:      sel('[data-recent-signal-empty-hint]')?.getAttribute('letter-spacing') ?? null,
    pulseCount:     document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const hasTab = (s) => /tabular-nums/.test(s || '');

const results = {
  panel_count_fw_600:        probe.panelCountFw === '600',
  panel_count_text_pattern:  /^\d+ node/.test(probe.panelCountText || ''),
  panel_count_tabular_kept:  hasTab(probe.panelCountFvn),
  r309_row_working_fw_600:   probe.rowCountWorkingFw === '600',
  r309_row_idle_fw_600:      probe.rowCountIdleFw === '600',
  r309_row_offline_fw_600:   probe.rowCountOfflineFw === '600',
  r308_working_label:        probe.workingLabel === 'working',
  r308_idle_label:           probe.idleLabel === 'idle',
  r307_offline_label:        probe.offlineLabel === 'offline',
  r306_focus_ring_1_kept:    probe.layoutRingCls.includes('focus-visible:ring-1'),
  r304_subhint_ls_0_15:      probe.subhintLs === '0.15',
  r294_pulse_absent:         probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend panel count weight:`, JSON.stringify(results),
  '\n  panel count:', probe.panelCountText, 'fw=', probe.panelCountFw,
  '\n  row counts fw:', probe.rowCountWorkingFw, '/', probe.rowCountIdleFw, '/', probe.rowCountOfflineFw);
process.exit(ok ? 0 : 1);
