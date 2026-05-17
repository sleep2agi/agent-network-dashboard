/* Round 455 verification: chrome fullscreen icon (ENTER + EXIT
 * variants) strokeWidth hover lift via Tailwind arbitrary class
 * group-hover:[stroke-width:2.8]. Completes the chrome icon hover
 * sw lift family (6 anchors).
 *
 * Contract:
 *   - rest: fullscreen-enter icon reports attr stroke-width '2.5' +
 *     computed '2.5px'
 *   - hover the fullscreen button: that icon computed '2.8px'
 *   - source-file probe confirms BOTH variants (enter + exit) carry
 *     the group-hover:[stroke-width:2.8] class
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
await page.waitForSelector('[data-topo-chrome-fullscreen-icon]', { timeout: 15000 });
await page.waitForTimeout(400);

const readIcon = () => page.evaluate(() => {
  const i = document.querySelector('[data-topo-chrome-fullscreen-icon]');
  return i ? {
    variant:      i.getAttribute('data-topo-chrome-fullscreen-icon'),
    sw_attr:      i.getAttribute('stroke-width'),
    sw_computed:  getComputedStyle(i).strokeWidth,
  } : null;
});

const rest = await readIcon();

// Hover the fullscreen button parent — the button shares the group
// scope with the SVG icon child via Tailwind group/group-hover utility.
let hover = null;
const btn = await page.$('button[aria-label*="fullscreen" i], button[title*="ullscreen" i]');
if (btn) {
  await btn.hover({ force: true });
  await page.waitForTimeout(300);
  hover = await readIcon();
  await page.mouse.move(0, 0);
}

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
// className appears in TWO fullscreen-icon SVGs (enter + exit). Probe
// for both variants via separate searches:
const sourceFullscreenIconCount = (fileText.match(/data-topo-chrome-fullscreen-icon=/g) || []).length;
const sourceArbitrarySwCount = (fileText.match(/group-hover:\[stroke-width:2\.8\]/g) || []).length;
// We expect: zoom-in + zoom-out + fullscreen-enter + fullscreen-exit = 4 total
const sourceFourMatches = sourceArbitrarySwCount >= 4;

await browser.close();

const results = {
  rest_mounted:                !!rest,
  rest_attr_2_5:               rest?.sw_attr === '2.5',
  rest_computed_2_5:           rest?.sw_computed === '2.5px' || rest?.sw_computed === '2.5',
  hover_computed_2_8:          hover?.sw_computed === '2.8px' || hover?.sw_computed === '2.8',
  source_fullscreen_variants:  sourceFullscreenIconCount === 2,
  source_arbitrary_4_matches:  sourceFourMatches,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chrome fullscreen icon sw hover:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover:', JSON.stringify(hover),
  '\n  source matches: variants=' + sourceFullscreenIconCount + ' arbitrary-sw=' + sourceArbitrarySwCount);
process.exit(ok ? 0 : 1);
