/* Round 429 verification: node label-card body opacity 0.94 → 1.0 on
 * hover (cyber theme). Sibling to R348 panel rect opacity lift at
 * panel scope. Adds a solidity axis to node hover signature alongside
 * R217 stroke tint + R142 drop-shadow + R26 lift + R427/R428 ls.
 *
 * Contract:
 *   - rest (cyber): every label-card reports opacity '0.94'
 *   - rest elevation attr 'idle' on all cards
 *   - hover one node: that card opacity '1' + elevation 'hover'
 *   - siblings stay at 0.94 / 'idle'
 *   - source-file probe confirms conditional + R246 transition intact
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
await page.waitForSelector('[data-node-label-card]', { timeout: 15000 });
await page.waitForTimeout(400);

const readAll = () => page.evaluate(() => {
  const rects = [...document.querySelectorAll('[data-node-label-card]')];
  return rects.map(t => ({
    alias:      t.getAttribute('data-node-label-card'),
    opacity:    t.getAttribute('opacity'),
    elevation:  t.getAttribute('data-node-label-card-elevation'),
  }));
});

const rest = await readAll();
const firstAlias = rest[0]?.alias;
let hover = null;
if (firstAlias) {
  const box = await page.evaluate((alias) => {
    const t = document.querySelector(`[data-node-label-card="${alias}"]`);
    if (!t) return null;
    const node = t.closest('[data-node]');
    const target = node || t;
    const b = target.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, firstAlias);
  if (box) {
    await page.mouse.move(box.x, box.y);
    await page.waitForTimeout(300);
    hover = await readAll();
    await page.mouse.move(0, 0);
  }
}

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /opacity=\{\s*\n?\s*!reducedMotion && hoveredAlias === session\.alias\s*\n?\s*\?\s*1\s*\n?\s*:\s*\(isLight \? 1 : 0\.94\)\s*\n?\s*\}/.test(fileText);
const sourceTransition = /transition: 'filter 220ms ease-out, stroke 220ms ease-out, fill 220ms ease-out, opacity 220ms ease-out'/.test(fileText);

await browser.close();

const hoveredEntry = hover?.find(r => r.alias === firstAlias);
const othersRest = hover ? hover.filter(r => r.alias !== firstAlias).every(r => r.opacity === '0.94' && r.elevation === 'idle') : false;

const results = {
  rest_card_count_gte_3:       rest.length >= 3,
  rest_all_opacity_0_94:       rest.every(r => r.opacity === '0.94'),
  rest_all_elevation_idle:     rest.every(r => r.elevation === 'idle'),
  hover_target_opacity_1:      hoveredEntry?.opacity === '1',
  hover_target_elevation:      hoveredEntry?.elevation === 'hover',
  hover_others_stay_idle:      othersRest,
  source_conditional_wired:    sourceWired,
  source_transition_intact:    sourceTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} label card opacity hover:`, JSON.stringify(results),
  '\n  hover target:', JSON.stringify(hoveredEntry));
process.exit(ok ? 0 : 1);
