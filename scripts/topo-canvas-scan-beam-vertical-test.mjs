/* Round 736 — vertical scan beam companion to R735's horizontal beam.
 * Forms the "scan beam" ambient family — coprime cadences mean the
 * beams never phase-lock; over time the visual rhythm reads as
 * "ambient crosshair drift".
 *
 *   R735 horizontal beam   30 s   (top → bottom)
 *   R736 vertical beam     23 s   (left → right) ← this round
 *   gcd(23, 30) = 1
 *
 * Assertions:
 *   - <rect data-topo-canvas-scan-beam-vertical> exists with 1×680 box
 *   - x animates -2 → 1000 → -2 over 23s repeatCount=indefinite
 *   - opacity animates 0 → 0.08 → 0.08 → 0 at keyTimes 0/0.05/0.95/1, dur 23s
 *   - SVG <title> child = "canvas scan beam vertical · ambient sweep · 23s cycle"
 *   - data-topo-canvas-scan-beam-vertical-active="true" (reducedMotion off)
 *   - vertical beam in background layer (rendered before nodes)
 *   - vertical beam rendered AFTER horizontal beam (pair grouping)
 *   - R735 horizontal beam still intact (regression — y, dur, title preserved)
 *   - coprime cadences: gcd(23, 30) === 1 — verified by checking the
 *     two beams' durs are 23s/30s and Math.gcd-equivalent reduces to 1
 *   - R732 a11y-titles catalog has 8 entries incl. vertical beam
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
await page.waitForSelector('[data-topo-canvas-scan-beam-vertical]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const state = await page.evaluate(() => {
  const vbeam = document.querySelector('[data-topo-canvas-scan-beam-vertical]');
  const hbeam = document.querySelector('[data-topo-canvas-scan-beam]');
  if (!vbeam || !hbeam) return null;
  const xAnim = vbeam.querySelector('animate[attributeName="x"]');
  const opAnim = vbeam.querySelector('animate[attributeName="opacity"]');
  const vtitle = vbeam.querySelector(':scope > title');
  const yAnim = hbeam.querySelector('animate[attributeName="y"]');
  const htitle = hbeam.querySelector(':scope > title');
  const svg = document.querySelector('[data-topo-canvas-aria]');
  const firstNode = svg?.querySelector('g[data-node]');
  const vbeamBeforeNodes = vbeam && firstNode
    ? (vbeam.compareDocumentPosition(firstNode) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    : null;
  const vbeamAfterHbeam = hbeam && vbeam
    ? (hbeam.compareDocumentPosition(vbeam) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    : null;
  const catalogAttr = svg?.getAttribute('data-topo-a11y-titles') ?? null;
  return {
    vbeam_present:           !!vbeam,
    vbeam_active_attr:       vbeam?.getAttribute('data-topo-canvas-scan-beam-vertical-active') ?? null,
    vbeam_width:             vbeam?.getAttribute('width') ?? null,
    vbeam_height:            vbeam?.getAttribute('height') ?? null,
    x_anim_present:          !!xAnim,
    x_anim_values:           xAnim?.getAttribute('values') ?? null,
    x_anim_dur:              xAnim?.getAttribute('dur') ?? null,
    x_anim_repeat:           xAnim?.getAttribute('repeatCount') ?? null,
    op_anim_present:         !!opAnim,
    op_anim_values:          opAnim?.getAttribute('values') ?? null,
    op_anim_dur:             opAnim?.getAttribute('dur') ?? null,
    op_anim_keytimes:        opAnim?.getAttribute('keyTimes') ?? null,
    vtitle_text:             vtitle?.textContent ?? null,
    hbeam_present:           !!hbeam,
    hbeam_y_dur:             yAnim?.getAttribute('dur') ?? null,
    hbeam_y_values:          yAnim?.getAttribute('values') ?? null,
    htitle_text:             htitle?.textContent ?? null,
    vbeam_before_nodes:      vbeamBeforeNodes,
    vbeam_after_hbeam:       vbeamAfterHbeam,
    catalog_includes_vbeam:  typeof catalogAttr === 'string' && catalogAttr.includes('canvas scan beam vertical'),
  };
});

await browser.close();

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
const coprime_23_30 = gcd(23, 30) === 1;

const results = {
  vbeam_rect_present:                 state?.vbeam_present === true,
  vbeam_active_true:                  state?.vbeam_active_attr === 'true',
  vbeam_1px_full_height:              state?.vbeam_width === '1' && state?.vbeam_height === '680',
  x_anim_full_sweep:                  state?.x_anim_present === true && state?.x_anim_values === '-2;1000;-2' && state?.x_anim_dur === '23s' && state?.x_anim_repeat === 'indefinite',
  vbeam_opacity_anim_ramped:          state?.op_anim_present === true && state?.op_anim_values === '0;0.08;0.08;0' && state?.op_anim_dur === '23s' && state?.op_anim_keytimes === '0;0.05;0.95;1',
  vbeam_a11y_title_present:           state?.vtitle_text === 'canvas scan beam vertical · ambient sweep · 23s cycle',
  vbeam_in_background_layer:          state?.vbeam_before_nodes === true,
  vbeam_after_horizontal_beam:        state?.vbeam_after_hbeam === true,
  hbeam_y_30s_preserved:              state?.hbeam_y_dur === '30s' && state?.hbeam_y_values === '-2;680;-2',
  hbeam_title_preserved:              state?.htitle_text === 'canvas scan beam · ambient sweep · 30s cycle',
  coprime_cadences_23_30:             coprime_23_30,
  r732_catalog_includes_vbeam:        state?.catalog_includes_vbeam === true,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R736 vertical scan beam (companion to R735, coprime cadences form ambient crosshair pair):`,
  JSON.stringify(results, null, 2),
  `\n  state: ${JSON.stringify(state)}`,
  `\n  gcd(23, 30) = ${gcd(23, 30)}`);
process.exit(ok ? 0 : 1);
