/* Round 542 verification: pressure-bar segments gain drop-shadow tier-
 * color glow on hover, stacked with R210 brightness(1.2). Chip-row
 * tier-color glow sub-family 3rd anchor.
 *
 * Test phases:
 *   1. rest: filter='none', data-pressure-seg-hovered='false'
 *   2. hover the working seg: filter contains 'brightness(1.2)'
 *      AND 'drop-shadow(...)' with the working tier color (cyber
 *      #22c55e = rgb(34, 197, 94))
 *   3. source-side regex confirms stacked filter syntax with hex+alpha
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
await page.waitForTimeout(800);

const sel = '[data-pressure-seg="working"]';

const restRead = async () => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    hovered:     el.getAttribute('data-pressure-seg-hovered'),
    filter:      cs.filter,
    inlineFilter: el.style.filter,
  };
}, sel);

// Phase 1: rest
const rest = await restRead();

// Phase 2: hover working seg
await page.hover(sel);
await page.waitForTimeout(400);
const hover = await restRead();

await browser.close();

// Source regex
const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter =
  /filter: hoveredStatus === key \? `brightness\(1\.2\) drop-shadow\(0 0 2px \$\{color\}99\)` : undefined,/.test(src);

const results = {
  rest_hovered_false:    rest?.hovered === 'false',
  rest_filter_none:      rest?.filter === 'none' || rest?.filter === '',
  hover_hovered_true:    hover?.hovered === 'true',
  hover_brightness:      /brightness\(1\.2\)/.test(hover?.filter || ''),
  hover_drop_shadow:     /drop-shadow/.test(hover?.filter || ''),
  // Cyber working color #22c55e → rgb(34, 197, 94) — accept any of the
  // computed color() forms.
  hover_working_color:   /rgba?\(34,?\s*197,?\s*94/.test(hover?.filter || ''),  // R537 banked: rgba? not rgb (hex+alpha → rgba)
  source_filter:         sourceFilter,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R542 pressure-seg tier-color glow:`,
  JSON.stringify(results, null, 2),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover:', JSON.stringify(hover));
process.exit(ok ? 0 : 1);
