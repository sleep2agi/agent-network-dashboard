/* Round 576 verification: chrome fullscreen icon gains hover-rotate-3.
 * 4th anchor in hover-rotate idiom (R350 reset / R547 pill × / R549
 * brand logo / R576 fullscreen).
 *
 * Banked R547 Tailwind 4 pattern — probe cs.rotate (individual CSS
 * property), not cs.transform.
 *
 * Test phases:
 *   1. rest: fullscreen icon cs.rotate = 'none' (or '0deg')
 *   2. hover the fullscreen button → icon rotate = '3deg' (+ scale 1.1)
 *   3. source-side regex: 2 occurrences (enter + exit) of
 *      'group-hover:rotate-3'
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
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-chrome-fullscreen-icon="enter"]', { timeout: 15000 });
await page.waitForTimeout(500);

// Locate the parent button (the <button aria-label="Enter fullscreen">).
const fullscreenButtonSel = 'button[aria-label*="fullscreen" i], button[aria-label*="Fullscreen"]';
const iconSel = '[data-topo-chrome-fullscreen-icon="enter"]';

const rest = await page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    rotate: cs.rotate,
    scale: cs.scale,
  };
}, iconSel);

// Hover the parent button
await page.hover(fullscreenButtonSel);
await page.waitForTimeout(400);
const hover = await page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    rotate: cs.rotate,
    scale: cs.scale,
  };
}, iconSel);

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const occurrences = (src.match(/group-hover:scale-110 group-hover:rotate-3 group-hover:\[stroke-width:2\.8\]/g) || []).length;

const results = {
  rest_rotate_idle:        rest?.rotate === 'none' || rest?.rotate === '0deg',
  rest_scale_idle:         rest?.scale === 'none' || rest?.scale === '1',
  hover_rotate_3deg:       hover?.rotate === '3deg',
  hover_scale_110:         hover?.scale === '1.1',
  source_2_occurrences:    occurrences === 2,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R576 fullscreen icon hover-rotate-3 (4th anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`,
  `\n  hover: ${JSON.stringify(hover)}`,
  `\n  source 2-occurrence count: ${occurrences}`);
process.exit(ok ? 0 : 1);
