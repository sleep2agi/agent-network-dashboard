/* Round 636 — extend hub-spoke filter gate from hub-wide
 * (hoveredHub) to per-spoke (isHoveredSpoke). Closes the 4-axis
 * chat-target focus signature on the hub-spoke surface:
 *   R622  opacity     0.50 → 0.70 / 0.80 → 0.95 (per-spoke)
 *   R622  stroke-wd   1.00 → 1.25 / 2.25 → 2.50 (per-spoke)
 *   R580  drop-shadow halo (hub-wide only — pre-R636)
 *   R580  brightness  1.0  → 1.15 (hub-wide only — pre-R636)
 *   R636  drop-shadow + brightness ALSO on isHoveredSpoke (per-spoke)
 *
 * Test phases:
 *   1. mock 2 nodes → spokes present, no hover/chat
 *   2. rest: per-spoke brightness-self='false', brightness='1',
 *      glow='false'
 *   3. open chat with one node (click) → that node's spoke
 *      brightness-self='true', brightness='1.15', glow='true';
 *      OTHER spoke stays brightness-self='false', brightness='1'
 *   4. source: filter expression + attrs include
 *      (hoveredHub || isHoveredSpoke) OR-chain
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
await page.waitForSelector('[data-topo-hub-spoke-brightness-self]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const restPerSpoke = await page.evaluate(() => {
  const spokes = Array.from(document.querySelectorAll('[data-topo-hub-spoke-brightness-self]'));
  return spokes.map(el => ({
    self:       el.getAttribute('data-topo-hub-spoke-brightness-self'),
    brightness: el.getAttribute('data-topo-hub-spoke-brightness'),
    glow:       el.getAttribute('data-topo-hub-spoke-glow'),
  }));
});

// Open chat with a·1
await page.click('[data-node="a·1"]', { force: true });
await page.waitForTimeout(400);

const chatPerSpoke = await page.evaluate(() => {
  // Each spoke is paired with its node alias via path key (`hub-${alias}`)
  // — but key isn't queryable. We look at all spokes and find the one
  // whose brightness-self attr is now 'true'.
  const spokes = Array.from(document.querySelectorAll('[data-topo-hub-spoke-brightness-self]'));
  return spokes.map(el => ({
    self:       el.getAttribute('data-topo-hub-spoke-brightness-self'),
    brightness: el.getAttribute('data-topo-hub-spoke-brightness'),
    glow:       el.getAttribute('data-topo-hub-spoke-glow'),
  }));
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilterGate = /filter: !reducedMotion && \(hoveredHub \|\| isHoveredSpoke\)\s*\n\s*\?\s*\(isLight/.test(src);
const sourceBrightnessAttr = /data-topo-hub-spoke-brightness=\{!reducedMotion && \(hoveredHub \|\| isHoveredSpoke\) \? '1\.15' : '1'\}/.test(src);
const sourceSelfAttr = /data-topo-hub-spoke-brightness-self=\{!reducedMotion && isHoveredSpoke \? 'true' : 'false'\}/.test(src);
const sourceGlowGate = /data-topo-hub-spoke-glow=\{!reducedMotion && \(hoveredHub \|\| isHoveredSpoke\) \? 'true' : 'false'\}/.test(src);

const restAllSelfFalse = restPerSpoke.every(s => s.self === 'false');
const restAllBrightness1 = restPerSpoke.every(s => s.brightness === '1');
const restAllGlowFalse = restPerSpoke.every(s => s.glow === 'false');

const chatActiveSpokes = chatPerSpoke.filter(s => s.self === 'true');
const chatIdleSpokes   = chatPerSpoke.filter(s => s.self === 'false');
const chatExactlyOneActive = chatActiveSpokes.length === 1;
const chatActiveBrightness115 = chatActiveSpokes.every(s => s.brightness === '1.15');
const chatActiveGlowTrue = chatActiveSpokes.every(s => s.glow === 'true');
const chatIdleBrightness1 = chatIdleSpokes.every(s => s.brightness === '1');
const chatIdleGlowFalse = chatIdleSpokes.every(s => s.glow === 'false');

const results = {
  spokes_present:           restPerSpoke.length >= 2,
  rest_all_self_false:      restAllSelfFalse,
  rest_all_brightness_1:    restAllBrightness1,
  rest_all_glow_false:      restAllGlowFalse,
  chat_exactly_one_active:  chatExactlyOneActive,
  chat_active_brightness:   chatActiveBrightness115,
  chat_active_glow:         chatActiveGlowTrue,
  chat_idle_brightness:    chatIdleBrightness1,
  chat_idle_glow_false:    chatIdleGlowFalse,
  source_filter_gate:       sourceFilterGate,
  source_brightness_attr:   sourceBrightnessAttr,
  source_self_attr:         sourceSelfAttr,
  source_glow_gate:         sourceGlowGate,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R636 hub-spoke per-spoke filter (chat-target / hover-self gate):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(restPerSpoke)}`,
  `\n  chat: ${JSON.stringify(chatPerSpoke)}`);
process.exit(ok ? 0 : 1);
