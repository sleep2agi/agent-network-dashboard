/* Round 440 verification: node halo opacity hover lift —
 * online cyber 0.65 → 0.80 on hoveredAlias match. Pure paint axis;
 * no geometry change.
 *
 * Contract:
 *   - rest: every halo reports data-node-halo-hovered='false' and
 *     resolved-opacity matching its tier (online cyber 0.65)
 *   - hover one node: that halo flips to hovered='true' + resolved-
 *     opacity '0.8'
 *   - siblings stay rest
 *   - R51 sentinel intact (overlap test still finds nodes)
 *   - source-file probe confirms IIFE + conditional wired
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
    mk('gamma', 'working'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-node-halo-hovered]', { timeout: 15000 });
await page.waitForTimeout(400);

const readAll = () => page.evaluate(() => {
  const cs = [...document.querySelectorAll('[data-node-halo-hovered]')];
  return cs.map(c => {
    const node = c.closest('[data-node]');
    return {
      alias:   node?.getAttribute('data-node') || null,
      hovered: c.getAttribute('data-node-halo-hovered'),
      opacity: parseFloat(c.getAttribute('data-node-halo-resolved-opacity') || '0'),
    };
  });
});

const rest = await readAll();

let hover = null;
const box = await page.evaluate(() => {
  const t = document.querySelector('[data-node-alias-text="alpha"]');
  if (!t) return null;
  const node = t.closest('[data-node]');
  const target = node || t;
  const b = target.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
if (box) {
  await page.mouse.move(box.x, box.y);
  await page.waitForTimeout(300);
  hover = await readAll();
  await page.mouse.move(0, 0);
}

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceIIFE      = /const isHaloHovered = !reducedMotion && hoveredAlias === session\.alias/.test(fileText);
const sourceCyberOnline = /isLight \? \(isHaloHovered \? 1\s*:\s*0\.85\) : \(isHaloHovered \? 0\.80 : 0\.65\)/.test(fileText);

await browser.close();

const restAllRest      = rest.length > 0 && rest.every(r => r.hovered === 'false' && r.opacity === 0.65);
const hoveredEntry     = hover?.find(r => r.alias === 'alpha');
const hoverTarget08    = hoveredEntry?.opacity === 0.80;
const hoverTargetFlag  = hoveredEntry?.hovered === 'true';
const othersStayRest   = hover ? hover.filter(r => r.alias !== 'alpha').every(r => r.hovered === 'false' && r.opacity === 0.65) : false;

const results = {
  rest_halo_count_ge_3:      rest.length >= 3,
  rest_all_rest_state:       restAllRest,
  hover_target_opacity_0_8:  hoverTarget08,
  hover_target_attr_true:    hoverTargetFlag,
  hover_others_stay_rest:    othersStayRest,
  source_IIFE_wired:         sourceIIFE,
  source_cyber_online_wired: sourceCyberOnline,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} node-halo hover opacity:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover target:', JSON.stringify(hoveredEntry));
process.exit(ok ? 0 : 1);
