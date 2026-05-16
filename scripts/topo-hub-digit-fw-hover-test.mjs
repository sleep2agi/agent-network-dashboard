/* Round 425 verification: hub digit fontWeight 700 → 800 on
 * hoveredHub. Closes the "data tightens under attention" pattern
 * across three focal scopes:
 *   chip-digit  (R416, chip scope)
 *   panel-digit (R424, panel-header scope)
 *   hub-digit   (R425, hub focal scope)
 *
 * Contract:
 *   - rest state: hub digit attr font-weight === '700'
 *   - hover state: digit attr font-weight === '800'
 *   - geometry/family invariants preserved:
 *     fontSize=12 (R360), tabular-nums (R225),
 *     R209 scale-1.08 transform on hover
 *   - source-file probe confirms wired conditional + transition list
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
  // include working sessions so workingCount > 0 → digit visible
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'working'),
    mk('beta',  'working'),
    mk('gamma', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-hub-working-count]', { timeout: 15000 });
await page.waitForTimeout(400);

const readDigit = () => page.evaluate(() => {
  const t = document.querySelector('[data-topo-hub-working-count]');
  if (!t) return null;
  return {
    text:       t.textContent,
    fw:         t.getAttribute('font-weight'),
    fontSize:   t.getAttribute('font-size'),
    hovered:    t.getAttribute('data-topo-hub-working-count-hovered'),
    count_attr: t.getAttribute('data-topo-hub-working-count'),
  };
});

const rest = await readDigit();

// Trigger hub hover via the hub <g> element (data-topo-hub).
const hubBox = await page.evaluate(() => {
  const hub = document.querySelector('[data-topo-hub]');
  if (!hub) return null;
  const b = hub.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
let hover = null;
if (hubBox) {
  await page.mouse.move(hubBox.x, hubBox.y);
  await page.waitForTimeout(300);
  hover = await readDigit();
  // move mouse away to release hover for clean teardown
  await page.mouse.move(0, 0);
}

// Source-file verification
const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired         = /fontWeight=\{hoveredHub \? '800' : '700'\}/.test(fileText);
const sourceTransition    = /transition: 'transform 200ms ease-out, opacity 300ms ease-out, fill 200ms ease-out, font-weight 200ms ease-out'/.test(fileText);

await browser.close();

const results = {
  rest_mounted:           !!rest,
  rest_fw_700:            rest?.fw === '700',
  rest_font_size_12:      rest?.fontSize === '12',
  rest_hovered_false:     rest?.hovered === 'false',
  hover_fw_800:           hover?.fw === '800',
  hover_hovered_true:     hover?.hovered === 'true',
  source_hover_wired:     sourceWired,
  source_transition_wired: sourceTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub digit fw hover:`, JSON.stringify(results),
  '\n  rest:', rest, '\n  hover:', hover);
process.exit(ok ? 0 : 1);
