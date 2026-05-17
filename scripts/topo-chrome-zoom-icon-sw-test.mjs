/* Round 454 verification: chrome zoom +/- icons strokeWidth hover lift
 * via Tailwind arbitrary class group-hover:[stroke-width:2.8].
 * The attribute strokeWidth='2.5' stays at rest; CSS hover overrides
 * with stroke-width: 2.8.
 *
 * Contract:
 *   - rest: zoom-in/zoom-out icons report computed stroke-width '2.5px'
 *   - hover the zoom-in button: that icon computed stroke-width '2.8px'
 *   - source-file probe confirms group-hover:[stroke-width:2.8] in
 *     both icon className strings
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

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
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'working'),
    mk('beta',  'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-chrome-zoom-in-icon]', { timeout: 15000 });
await page.waitForTimeout(400);

const readIcons = () => page.evaluate(() => {
  const zi = document.querySelector('[data-topo-chrome-zoom-in-icon]');
  const zo = document.querySelector('[data-topo-chrome-zoom-out-icon]');
  return {
    zoom_in:  zi ? { sw: zi.getAttribute('stroke-width'), sw_computed: getComputedStyle(zi).strokeWidth } : null,
    zoom_out: zo ? { sw: zo.getAttribute('stroke-width'), sw_computed: getComputedStyle(zo).strokeWidth } : null,
  };
});

const rest = await readIcons();

// Hover zoom-in button
let hover = null;
const btn = await page.$('[data-topo-chrome-zoom-in]');
if (btn) {
  await btn.hover({ force: true });
  await page.waitForTimeout(300);
  hover = await readIcons();
  await page.mouse.move(0, 0);
}

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
// className appears BEFORE data-attr on the icon SVG, so check both
// orderings + count >= 2 to confirm both zoom icons have the class.
const sourceMatch   = fileText.match(/group-hover:\[stroke-width:2\.8\]/g);
const sourceTwoMatches = sourceMatch && sourceMatch.length >= 2;
const sourceZoomOut = /group-hover:\[stroke-width:2\.8\][\s\S]{0,400}data-topo-chrome-zoom-out-icon/.test(fileText);
const sourceZoomIn  = /group-hover:\[stroke-width:2\.8\][\s\S]{0,400}data-topo-chrome-zoom-in-icon/.test(fileText);

await browser.close();

const results = {
  rest_zi_attr_2_5:        rest.zoom_in?.sw === '2.5',
  rest_zo_attr_2_5:        rest.zoom_out?.sw === '2.5',
  rest_zi_computed_2_5:    rest.zoom_in?.sw_computed === '2.5px' || rest.zoom_in?.sw_computed === '2.5',
  hover_zi_computed_2_8:   hover?.zoom_in?.sw_computed === '2.8px' || hover?.zoom_in?.sw_computed === '2.8',
  source_zoom_out_wired:   sourceZoomOut,
  source_zoom_in_wired:    sourceZoomIn,
  source_two_matches:      sourceTwoMatches,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chrome zoom icon sw hover:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover:', JSON.stringify(hover));
process.exit(ok ? 0 : 1);
