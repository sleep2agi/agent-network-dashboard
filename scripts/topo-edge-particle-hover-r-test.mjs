/* Round 439 verification: edge flow particle radius hover lift —
 * r 4.5 → 5.5 on (isHoveredEdge || isEndpointHoveredEdge). Continues
 * the edge paint-layer parity arc (R436 visible path / R437 flow rail
 * / R439 particle).
 *
 * Contract:
 *   - rest: every particle reports data-edge-particle-radius '4.5' +
 *     lifted='false'
 *   - hover one node alias: particles on edges incident to that node
 *     report radius '5.5' + lifted='true'
 *   - siblings unaffected
 *   - source-file probe confirms conditional + transition extension
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
    mk('gamma', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({
  json: { messages: [
    { id: 'm1', from_alias: 'alpha', to_alias: 'beta',  content: 'ping', created_at: fresh, network_id: 'default' },
    { id: 'm2', from_alias: 'alpha', to_alias: 'gamma', content: 'pong', created_at: fresh, network_id: 'default' },
    { id: 'm3', from_alias: 'gamma', to_alias: 'beta',  content: 'pang', created_at: fresh, network_id: 'default' },
  ] },
}));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-edge-particle]', { timeout: 15000 });
await page.waitForTimeout(400);

const readAll = () => page.evaluate(() => {
  const ps = [...document.querySelectorAll('[data-edge-particle]')];
  return ps.map(p => ({
    key:    p.getAttribute('data-edge-particle'),
    r_attr: p.getAttribute('r'),
    r_data: parseFloat(p.getAttribute('data-edge-particle-radius') || '0'),
    lifted: p.getAttribute('data-edge-particle-lifted'),
  }));
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
const sourceWired      = /r=\{\(isHoveredEdge \|\| isEndpointHoveredEdge\) \? 5\.5 : 4\.5\}/.test(fileText);
const sourceTransition = /transition: 'fill 200ms ease-out, opacity 200ms ease-out, r 200ms ease-out'/.test(fileText);

await browser.close();

const isAlphaKey = (k) => /alpha/i.test(k);
const hoverByKey = new Map((hover || []).map(h => [h.key, h]));
const alphaEntries    = [...hoverByKey.entries()].filter(([k]) => isAlphaKey(k));
const nonAlphaEntries = [...hoverByKey.entries()].filter(([k]) => !isAlphaKey(k));

const restAllR_4_5     = rest.every(r => r.r_data === 4.5);
const restNoneLifted   = rest.every(r => r.lifted === 'false');
const alphaAllR_5_5    = alphaEntries.length > 0 && alphaEntries.every(([, h]) => h.r_data === 5.5 && h.lifted === 'true');
const nonAlphaRestR    = nonAlphaEntries.every(([, h]) => h.r_data === 4.5 && h.lifted === 'false');

const results = {
  rest_particle_count_ge_2:    rest.length >= 2,
  rest_all_r_4_5:              restAllR_4_5,
  rest_none_lifted:            restNoneLifted,
  hover_alpha_count_ge_2:      alphaEntries.length >= 2,
  hover_alpha_all_lifted_5_5:  alphaAllR_5_5,
  hover_non_alpha_unaffected:  nonAlphaRestR,
  source_r_wired:              sourceWired,
  source_transition_wired:     sourceTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge-particle r hover lift:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover:', JSON.stringify(hover));
process.exit(ok ? 0 : 1);
