/* Round 307 verification: legend offline row label drops the
 * '· no SSE' qualifier. 'offline · no SSE' (16 chars) → 'offline'
 * (7 chars). Visual already communicates the disconnected state
 * via status ring dashed pattern + gray fill + gray swatch.
 *
 * Contract:
 *   - [data-legend-row-label='offline'] text content === 'offline'.
 *   - Does NOT contain 'no SSE' substring.
 *   - Working row label still 'working node'.
 *   - Idle row label still 'online idle'.
 *   - R306 focus-ring-1 + R305 alias chat-target attr + R304/R302/
 *     R301/R294 regressions intact.
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
  const offlineLabel = sel('[data-legend-row-label="offline"]');
  const workingLabel = sel('[data-legend-row-label="working"]');
  const idleLabel    = sel('[data-legend-row-label="idle"]');
  const layoutRing   = sel('[data-topo-chrome-layout="ring"]');
  const alias        = sel('[data-node-alias-text]');
  const subhint      = sel('[data-recent-signal-empty-hint]');
  return {
    offlineText:        txt(offlineLabel),
    workingText:        txt(workingLabel),
    idleText:           txt(idleLabel),
    layoutRingCls:      layoutRing?.className ?? '',
    aliasChatTargetAttr: alias?.hasAttribute('data-node-alias-chat-target') ?? false,
    subhintLs:          subhint?.getAttribute('letter-spacing') ?? null,
    pulseCount:         document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const results = {
  offline_label_simplified:        probe.offlineText === 'offline',
  offline_label_no_sse_dropped:    !/no SSE/i.test(probe.offlineText),
  // R308 superseded the working/idle assertions — both labels were
  // simplified further (working node → working, online idle → idle).
  // Keep this test focused on R307's offline simplification.
  r306_layout_ring_1_kept:         probe.layoutRingCls.includes('focus-visible:ring-1'),
  r306_layout_no_ring_2:           !probe.layoutRingCls.includes('focus-visible:ring-2'),
  r305_alias_chat_target_attr:     probe.aliasChatTargetAttr,
  r304_subhint_ls_0_15:            probe.subhintLs === '0.15',
  r294_pulse_absent:               probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend offline label simplify:`, JSON.stringify(results),
  '\n  offline:', JSON.stringify(probe.offlineText),
  '\n  working:', JSON.stringify(probe.workingText),
  '\n  idle:',    JSON.stringify(probe.idleText));
process.exit(ok ? 0 : 1);
