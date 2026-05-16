/* Round 308 verification: continue R307 legend label 减法.
 * 'working node' → 'working' (drops 'node' qualifier).
 * 'online idle' → 'idle' (drops 'online' qualifier).
 * Plus R307 'offline' (already simplified).
 *
 * After R307+R308 all three legend labels are just status words:
 * working / idle / offline — 3-state list at 7 / 4 / 7 chars.
 *
 * Contract:
 *   - [data-legend-row-label='working'] text === 'working'.
 *   - [data-legend-row-label='idle']    text === 'idle'.
 *   - [data-legend-row-label='offline'] text === 'offline' (R307).
 *   - No labels contain ' node' or 'online ' substrings.
 *   - R306 focus-ring-1 + R304 sub-hint ls=0.15 + R294 pulse absent intact.
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
await page.waitForSelector('[data-legend-row-label="offline"]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const sel = (s) => document.querySelector(s);
  const txt = (el) => (el?.textContent || '').trim();
  const layoutRing = sel('[data-topo-chrome-layout="ring"]');
  return {
    workingText:   txt(sel('[data-legend-row-label="working"]')),
    idleText:      txt(sel('[data-legend-row-label="idle"]')),
    offlineText:   txt(sel('[data-legend-row-label="offline"]')),
    layoutRingCls: layoutRing?.className ?? '',
    subhintLs:     sel('[data-recent-signal-empty-hint]')?.getAttribute('letter-spacing') ?? null,
    pulseCount:    document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const results = {
  working_simplified:       probe.workingText === 'working',
  idle_simplified:          probe.idleText === 'idle',
  offline_kept_r307:        probe.offlineText === 'offline',
  no_node_qualifier:        !/ node\b/i.test(probe.workingText),
  no_online_qualifier:      !/online /i.test(probe.idleText),
  r306_focus_ring_1_kept:   probe.layoutRingCls.includes('focus-visible:ring-1'),
  r304_subhint_ls_0_15:     probe.subhintLs === '0.15',
  r294_pulse_absent:        probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend rows simplified:`, JSON.stringify(results),
  '\n  working:', JSON.stringify(probe.workingText),
  '\n  idle:',    JSON.stringify(probe.idleText),
  '\n  offline:', JSON.stringify(probe.offlineText));
process.exit(ok ? 0 : 1);
