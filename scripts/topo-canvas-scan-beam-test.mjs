/* Round 735 — SVG scan beam: ambient living-system sweep across the
 * canvas every 30 s. Pivot round: first genuinely new VISIBLE
 * animation outside the breath / a11y / meta-doc threads since R720.
 *
 * Spec:
 *   - 1 px tall horizontal cyan stripe (pal.legendAccent)
 *   - y animates -2 → 680 → -2 over 30 s repeatCount=indefinite
 *   - opacity animates 0 → 0.08 → 0.08 → 0 at keyTimes 0/0.05/0.95/1
 *   - pointer-events: none, no business logic
 *   - rendered AFTER panel backdrop, BEFORE all other canvas content
 *     (background layer; nodes paint over it)
 *   - gated by !reducedMotion at JSX level
 *   - SVG <title> child for a11y ("canvas scan beam · ambient sweep · 30s cycle")
 *
 * Assertions:
 *   - <rect data-topo-canvas-scan-beam> exists
 *   - Two <animate> children: attributeName="y" and attributeName="opacity"
 *   - y animate has values "-2;680;-2" and dur "30s"
 *   - opacity animate has values "0;0.08;0.08;0" and dur "30s"
 *   - <title> child has the expected accessible name
 *   - data-topo-canvas-scan-beam-active="true" (reducedMotion off in test)
 *   - Beam is rendered BEFORE nodes (background-layer z-order)
 *   - R732 a11y-titles catalog has the scan-beam entry (7 total)
 *   - Overlap-test selectors don't match the rect (no data-node /
 *     data-group, no matching translate prefix) — verified indirectly
 *     by overlap test still passing
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1'), mk('a·2')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-canvas-scan-beam]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const state = await page.evaluate(() => {
  const beam = document.querySelector('[data-topo-canvas-scan-beam]');
  if (!beam) return null;
  const yAnim = beam.querySelector('animate[attributeName="y"]');
  const opAnim = beam.querySelector('animate[attributeName="opacity"]');
  const titleEl = beam.querySelector(':scope > title');
  const svg = document.querySelector('[data-topo-canvas-aria]');
  const firstNode = svg?.querySelector('g[data-node]');
  const beamBeforeNodes = beam && firstNode
    ? (beam.compareDocumentPosition(firstNode) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    : null;
  const catalogAttr = svg?.getAttribute('data-topo-a11y-titles') ?? null;
  return {
    beam_present:          !!beam,
    beam_active_attr:      beam?.getAttribute('data-topo-canvas-scan-beam-active') ?? null,
    beam_width:            beam?.getAttribute('width') ?? null,
    beam_height:           beam?.getAttribute('height') ?? null,
    y_anim_present:        !!yAnim,
    y_anim_values:         yAnim?.getAttribute('values') ?? null,
    y_anim_dur:            yAnim?.getAttribute('dur') ?? null,
    y_anim_repeat:         yAnim?.getAttribute('repeatCount') ?? null,
    op_anim_present:       !!opAnim,
    op_anim_values:        opAnim?.getAttribute('values') ?? null,
    op_anim_dur:           opAnim?.getAttribute('dur') ?? null,
    op_anim_keytimes:      opAnim?.getAttribute('keyTimes') ?? null,
    title_text:            titleEl?.textContent ?? null,
    beam_before_nodes:     beamBeforeNodes,
    catalog_has_entry:     typeof catalogAttr === 'string' && catalogAttr.includes('canvas scan beam'),
  };
});

await browser.close();

const results = {
  beam_rect_present:               state?.beam_present === true,
  beam_active_true:                state?.beam_active_attr === 'true',
  beam_full_width_1px:             state?.beam_width === '1000' && state?.beam_height === '1',
  y_anim_full_sweep:               state?.y_anim_present === true && state?.y_anim_values === '-2;680;-2' && state?.y_anim_dur === '30s' && state?.y_anim_repeat === 'indefinite',
  opacity_anim_ramped:             state?.op_anim_present === true && state?.op_anim_values === '0;0.08;0.08;0' && state?.op_anim_dur === '30s' && state?.op_anim_keytimes === '0;0.05;0.95;1',
  a11y_title_present:              state?.title_text === 'canvas scan beam · ambient sweep · 30s cycle',
  beam_in_background_layer:        state?.beam_before_nodes === true,
  r732_catalog_includes_beam:      state?.catalog_has_entry === true,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R735 SVG canvas scan beam (ambient 30s sweep, first non-introspection visible animation since R720):`,
  JSON.stringify(results, null, 2),
  `\n  state: ${JSON.stringify(state)}`);
process.exit(ok ? 0 : 1);
