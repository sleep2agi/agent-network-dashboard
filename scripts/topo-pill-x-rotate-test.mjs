/* Round 547 verification: pill × close buttons gain hover:rotate-12 alongside
 * existing hover:scale-110 (R356) + hover:opacity-70. 4 sibling buttons
 * (status / group / vendor / edge) edited via replace_all.
 *
 * Test phases:
 *   1. trigger a pin to render a pill (click pressure-bar working seg)
 *   2. inspect the pill's × button — rest transform=none
 *   3. hover the × button — computed transform contains rotate(12deg)
 *      AND scale(1.1)
 *   4. source-side regex confirms hover:rotate-12 in all 4 className
 *      strings via replace_all
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
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1', 'working'), mk('a·2', 'idle'), mk('a·3', 'offline'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-pressure-seg="working"]', { timeout: 15000 });
await page.waitForTimeout(500);

// Phase 1: trigger pin
await page.click('[data-pressure-seg="working"]');
await page.waitForTimeout(400);

// Phase 2: rest read on the × button (find via aria-label).
// Tailwind 4 uses individual CSS `scale` / `rotate` properties (NOT
// transform: scale(...) rotate(...)). Probe both — banked pattern note.
const xSel = 'button[aria-label="Clear working filter"]';
await page.waitForSelector(xSel, { timeout: 5000 });
const rest = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { transform: cs.transform, scale: cs.scale, rotate: cs.rotate };
}, xSel);

// Phase 3: hover the × button
await page.hover(xSel);
await page.waitForTimeout(400);
const hover = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { transform: cs.transform, scale: cs.scale, rotate: cs.rotate };
}, xSel);

await browser.close();

// Source regex — confirm className across all 4 instances
const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const occurrences = (src.match(/className="ml-0\.5 leading-none hover:opacity-70 transition-transform duration-200 ease-out hover:scale-110 hover:rotate-12 transform-gpu"/g) || []).length;

// Tailwind 4 emits individual `scale: ...` and `rotate: ...` CSS
// properties (not combined transform). Probe each axis separately.
const results = {
  rest_scale_none:       rest?.scale === 'none' || rest?.scale === '1' || rest?.scale === '1 1',
  rest_rotate_none:      rest?.rotate === 'none' || rest?.rotate === '0deg',
  hover_scale_110:       /\b1\.1\b/.test(hover?.scale || ''),
  hover_rotate_12:       /\b12deg\b/.test(hover?.rotate || ''),
  source_4_occurrences:  occurrences === 4,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R547 pill × hover-rotate:`,
  JSON.stringify(results, null, 2),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover:', JSON.stringify(hover),
  '\n  source occurrences:', occurrences);
process.exit(ok ? 0 : 1);
