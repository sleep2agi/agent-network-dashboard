/* Round 549 verification: title-block brand logo gains hover:rotate-6
 * paired with R548's hover:scale-105. Banked R547 Tailwind 4 pattern —
 * probe BOTH cs.scale AND cs.rotate (individual CSS properties, not
 * combined transform).
 *
 * Test phases:
 *   1. rest: scale='none' (or '1'), rotate='none' (or '0deg')
 *   2. hover: scale='1.05', rotate='6deg'
 *   3. source-side regex confirms className + data-attr wired
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
await page.waitForSelector('[data-topo-brand-logo]', { timeout: 15000 });
await page.waitForTimeout(500);

const sel = '[data-topo-brand-logo]';
const rest = await page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    attrScale:  el.getAttribute('data-topo-brand-logo-hover-scale'),
    attrRotate: el.getAttribute('data-topo-brand-logo-hover-rotate'),
    scale:      cs.scale,
    rotate:     cs.rotate,
  };
}, sel);

await page.hover(sel);
await page.waitForTimeout(400);
const hover = await page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { scale: cs.scale, rotate: cs.rotate };
}, sel);

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceClassNameWired =
  /className="shrink-0 transition-transform duration-200 ease-out hover:scale-105 hover:rotate-6 transform-gpu"/.test(src);
const sourceScaleAttrWired =
  /data-topo-brand-logo-hover-scale="1\.05"/.test(src);
const sourceRotateAttrWired =
  /data-topo-brand-logo-hover-rotate="6deg"/.test(src);

const results = {
  rest_scale_idle:        rest?.scale === 'none' || rest?.scale === '1',
  rest_rotate_idle:       rest?.rotate === 'none' || rest?.rotate === '0deg',
  rest_attr_scale_105:    rest?.attrScale === '1.05',
  rest_attr_rotate_6deg:  rest?.attrRotate === '6deg',
  hover_scale_105:        hover?.scale === '1.05',
  hover_rotate_6deg:      hover?.rotate === '6deg',
  source_classname:       sourceClassNameWired,
  source_scale_attr:      sourceScaleAttrWired,
  source_rotate_attr:     sourceRotateAttrWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R549 brand-logo hover-rotate-6 (paired with R548 scale-105):`,
  JSON.stringify(results, null, 2),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover:', JSON.stringify(hover));
process.exit(ok ? 0 : 1);
