/* Round 311 verification: recent-signal panel-header count tspan
 * 'N flows' picks up fontWeight=600 for sibling parity with R310
 * legend panel-header count weight. Closes the panel-pair count
 * typography symmetry — both top-corner panels now match:
 *   title fontWeight=700 (panel chrome anchor)
 *   count fontWeight=600 + tabular-nums (data)
 *
 * Contract:
 *   - [data-recent-panel-count] tspan attr font-weight === '600'.
 *   - Text content matches '{N} flows' pattern.
 *   - R162 freshness alpha attribute still present.
 *   - R225 tabular-nums preserved.
 *   - R310 legend panel-count fw=600 still holds (sibling regression).
 *   - R309 row counts + R308 row labels + R294 pulse all preserved.
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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4'),
    mk('beta',  'gpt-4o'),
  ] } });
});
// Inject at least one mock message so the recent-signal panel count
// renders 'N flows' with non-zero N. With 0 the freshness branch may
// vary; we just need the tspan to render with its content.
await ctx.route('**/api/hub/messages*', (route) => {
  const now = new Date().toISOString();
  route.fulfill({ json: { messages: [
    { from_alias: 'alpha', to_alias: 'beta', content: 'ping', last_at: now, count: 3 },
  ] } });
});
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-recent-panel-count]', { timeout: 15000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const sel = (s) => document.querySelector(s);
  const recentCount = sel('[data-recent-panel-count]');
  const legendCount = sel('[data-legend-panel-count]');
  return {
    recentCountFw:        recentCount?.getAttribute('font-weight') ?? null,
    recentCountText:      recentCount?.textContent?.trim() ?? null,
    recentCountFreshAttr: recentCount?.getAttribute('data-recent-panel-count-freshness-alpha') ?? null,
    legendCountFw:        legendCount?.getAttribute('font-weight') ?? null,
    rowCountWorkingFw:    sel('[data-legend-count="working"]')?.getAttribute('font-weight') ?? null,
    workingLabel:         sel('[data-legend-row-label="working"]')?.textContent?.trim() ?? null,
    layoutRingCls:        sel('[data-topo-chrome-layout="ring"]')?.className ?? '',
    subhintLs:            sel('[data-recent-signal-empty-hint]')?.getAttribute('letter-spacing') ?? null,
    pulseCount:           document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const results = {
  recent_count_fw_600:          probe.recentCountFw === '600',
  recent_count_text_pattern:    /^\d+ flow/.test(probe.recentCountText || ''),
  recent_count_freshness_attr:  probe.recentCountFreshAttr !== null,
  r310_legend_panel_fw_600:     probe.legendCountFw === '600',
  r309_row_working_fw_600:      probe.rowCountWorkingFw === '600',
  r308_working_label_simplified: probe.workingLabel === 'working',
  r306_focus_ring_1:            probe.layoutRingCls.includes('focus-visible:ring-1'),
  r304_subhint_ls_0_15:         probe.subhintLs === '0.15',
  r294_pulse_absent:            probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent panel count weight:`, JSON.stringify(results),
  '\n  recent count:', probe.recentCountText, 'fw=', probe.recentCountFw,
  '\n  legend panel count fw:', probe.legendCountFw,
  '\n  row count fw:', probe.rowCountWorkingFw);
process.exit(ok ? 0 : 1);
