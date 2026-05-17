/* Round 557 verification: title-block brand logo gains 4th hover
 * axis — hover:brightness-110 (filter). Composes with R548 scale +
 * R549 rotate + R553 idle breath.
 *
 * Test phases:
 *   1. rest: filter = 'none' (no brightness on idle, breath uses opacity)
 *   2. hover: filter contains 'brightness(1.1)' (or similar)
 *   3. data-attr present
 *   4. source: className contains hover:brightness-110 and
 *      transition-[transform,filter]
 *
 * R553 breath uses opacity, NOT filter — so filter stays clean at
 * rest. On hover, Tailwind adds filter: brightness(1.1).
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
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    transitionDuration: cs.transitionDuration,
    hoverBrightnessAttr: el.getAttribute('data-topo-brand-logo-hover-brightness'),
  };
}, sel);

await page.hover(sel);
await page.waitForTimeout(400);
const hover = await page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    scale: cs.scale,
    rotate: cs.rotate,
  };
}, sel);

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceClassname = /hover:brightness-110/.test(src);
const sourceTransition = /transition-\[transform,filter\] duration-200 ease-out hover:scale-105 hover:rotate-6 hover:brightness-110/.test(src);
const sourceAttr = /data-topo-brand-logo-hover-brightness="1\.1"/.test(src);

const results = {
  rest_filter_none:        rest?.filter === 'none',
  rest_brightness_attr:    rest?.hoverBrightnessAttr === '1.1',
  // Computed filter on hover should contain brightness(1.1) — handle
  // both raw and serialized forms.
  hover_filter_brightness: /brightness\(1\.1\)/.test(hover?.filter || ''),
  hover_scale_still_105:   hover?.scale === '1.05',
  hover_rotate_still_6:    hover?.rotate === '6deg',
  transition_has_transform: /transform/.test(rest?.transitionProperty || ''),
  transition_has_filter:   /filter/.test(rest?.transitionProperty || ''),
  // 3 axes (color + transform + filter) → '0.2s, 0.2s, 0.2s'
  transition_duration:     /^0\.2s(,\s*0\.2s)*$/.test(rest?.transitionDuration || ''),
  source_classname:        sourceClassname,
  source_transition_list:  sourceTransition,
  source_attr:             sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R557 brand-logo hover:brightness-110 (4th axis):`,
  JSON.stringify(results, null, 2),
  `\n  rest filter: ${rest?.filter}`,
  `\n  hover filter: ${hover?.filter}`,
  `\n  hover scale: ${hover?.scale}, rotate: ${hover?.rotate}`,
  `\n  transition: ${rest?.transitionProperty}`);
process.exit(ok ? 0 : 1);
