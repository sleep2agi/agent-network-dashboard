/* Round 386 verification: hub-highlight idle opacity 0.9 → 0.95.
 * Theme-consistency / canvas-presence polish family (4th anchor)
 * after R370 hub-ring 0.7→0.8 cyber, R371 edge-badge 0.82→0.85
 * cyber, R372 minimap offline 0.5→0.6. Lifts the focal point's
 * idle "lamp lit but no work" core from a faded 0.9 to a present
 * 0.95 (idle alpha gap halved).
 *
 * Contract:
 *   - When workingCount === 0 (all sessions idle / connected):
 *     * opacity attr === '0.95'
 *     * data-topo-hub-highlight-opacity === '0.95'
 *     * data-topo-hub-highlight-visible === 'true'
 *   - When workingCount > 0 (≥ 1 working session):
 *     * opacity attr === '0'  (R130 takeover gate preserved)
 *     * data-topo-hub-highlight-visible === 'false'
 *   - Pre-R386 invariants preserved:
 *     * data-topo-hub-highlight-radius === '5.5'  (R365)
 *     * fill === '#d1fae5'
 *
 * Test fixture supplies all-idle and all-working scenarios via
 * /api/hub/status route fulfillment.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

async function probeWith(sessionStatus) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
  });
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const mk = (alias) => ({
      alias, status: sessionStatus, model: 'claude-opus-4', runtime: 'claude-code-cli',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    await route.fulfill({ response: r, json: { ...b, sessions: [ mk('a'), mk('b') ] } });
  });
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-topo-hub-highlight]', { timeout: 15000 });
  await page.waitForTimeout(350);
  const probe = await page.evaluate(() => {
    const e = document.querySelector('[data-topo-hub-highlight]');
    return {
      opacityAttr: e?.getAttribute('opacity') ?? null,
      opacityData: e?.getAttribute('data-topo-hub-highlight-opacity') ?? null,
      visible:     e?.getAttribute('data-topo-hub-highlight-visible') ?? null,
      radius:      e?.getAttribute('data-topo-hub-highlight-radius') ?? null,
      fill:        e?.getAttribute('fill') ?? null,
    };
  });
  await browser.close();
  return probe;
}

const idle    = await probeWith('idle');
const working = await probeWith('working');

const results = {
  // Idle: lifted opacity 0.95 visible
  idle_opacity_attr_0_95:    idle.opacityAttr === '0.95',
  idle_opacity_data_0_95:    idle.opacityData === '0.95',
  idle_visible_true:         idle.visible === 'true',
  // Working: R130 takeover, opacity 0
  working_opacity_attr_0:    working.opacityAttr === '0',
  working_visible_false:     working.visible === 'false',
  // Cross-state invariants (R365 + fill)
  radius_5_5_idle:           idle.radius === '5.5',
  radius_5_5_working:        working.radius === '5.5',
  fill_d1fae5_idle:          idle.fill === '#d1fae5',
  fill_d1fae5_working:       working.fill === '#d1fae5',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub-highlight idle opacity 0.9 → 0.95:`, JSON.stringify(results),
  '\n  idle:   ', idle,
  '\n  working:', working);
process.exit(ok ? 0 : 1);
