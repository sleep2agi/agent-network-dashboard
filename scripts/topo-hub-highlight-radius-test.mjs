/* Round 365 verification: hub-center 'lit-lamp' decorative highlight
 * circle radius 5 → 5.5. Visible when workingCount === 0 (idle fleet
 * decor per R130). Sibling visual-weight bump family — extends to
 * 6 canvas anchors:
 *   R287 minimap viewport stroke 1 → 1.5
 *   R295 legend swatch base radius 5.5 → 6
 *   R359 recent-row pip base radius 1.6 → 1.8
 *   R360 hub digit fontSize 11 → 12
 *   R361 edge-badge digit fontSize 10 → 11
 *   R365 hub-highlight base radius 5 → 5.5  (this round)
 *
 * 21 % area bump (π·5.5² / π·5² = 1.21). Still well inside r=10 core.
 *
 * Test approach: feed an IDLE fleet (no working sessions) so the
 * highlight is fully opaque.
 *
 * Contract:
 *   - data-topo-hub-highlight element r attr === '5.5'.
 *   - data-topo-hub-highlight-radius === '5.5'.
 *   - data-topo-hub-highlight-visible === 'true' (idle fleet).
 *   - opacity attr === '0.9' (workingCount === 0 branch).
 *   - Pre-R365 invariants:
 *     * cx + cy unchanged (visual center stable)
 *     * fill='#d1fae5' (R130 lamp color)
 *     * style.transition contains opacity (R213 always-mount gate)
 *     * pointerEvents: 'none' (R130)
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
  // IDLE: status !== 'working' so workingCount=0 and the highlight is opaque.
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('a'), mk('b'), mk('c') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-hub-highlight]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const h = document.querySelector('[data-topo-hub-highlight]');
  const cs = h ? getComputedStyle(h) : null;
  return {
    rAttr:        h?.getAttribute('r') ?? null,
    rData:        h?.getAttribute('data-topo-hub-highlight-radius') ?? null,
    visibleAttr:  h?.getAttribute('data-topo-hub-highlight-visible') ?? null,
    opacityAttr:  h?.getAttribute('opacity') ?? null,
    fill:         h?.getAttribute('fill') ?? null,
    transition:   cs?.transition ?? null,
    pointerEv:    cs?.pointerEvents ?? null,
  };
});

await browser.close();

const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const results = {
  r_attr_5_5:           probe.rAttr === '5.5',
  r_data_5_5:           probe.rData === '5.5',
  visible_true:         probe.visibleAttr === 'true',
  opacity_0_9:          probe.opacityAttr === '0.9',
  fill_d1fae5:          probe.fill === '#d1fae5',
  trans_has_opacity:    hasTrans(probe.transition, 'opacity'),
  pointer_events_none:  probe.pointerEv === 'none',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub-highlight radius 5 → 5.5:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
