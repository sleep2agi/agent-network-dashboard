/* Round 584 verification: node status ring gains filter
 * brightness(1.15) on hover. 23rd anchor in per-element
 * brightness family. Stacks with url(#topo-glow) on
 * cyber+online; plain brightness on light or cyber+offline.
 *
 * Test phases:
 *   1. mock 2 idle nodes → status rings render
 *   2. rest (cyber+online): filter='url("#topo-glow")'
 *      (no brightness stacked, no hover state)
 *   3. brightness-attr='1' at rest
 *   4. transition-property contains 'filter'
 *   5. source: filter conditional (three-way tree) + data-attr
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
await page.waitForSelector('[data-node-status-ring]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-node-status-ring]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    brightnessAttr: el.getAttribute('data-node-status-ring-brightness'),
    hoveredAttr: el.getAttribute('data-node-status-ring-hovered'),
    label: el.getAttribute('data-node-status-ring'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: isRingHovered\s*\?\s*\(isLight\s*\?\s*'brightness\(1\.15\)'\s*:\s*\(isOnline\s*\?\s*'url\(#topo-glow\) brightness\(1\.15\)'\s*:\s*'brightness\(1\.15\)'\)\)\s*:\s*undefined/.test(src);
const sourceAttr = /data-node-status-ring-brightness=\{isRingHovered \? '1\.15' : '1'\}/.test(src);
const sourceTransition = /transition: 'fill 300ms ease-out, stroke 300ms ease-out, stroke-width 300ms ease-out, filter 300ms ease-out'/.test(src);

const results = {
  ring_present:           !!rest,
  // On cyber+online (mock default), SVG attribute filter applies at rest
  rest_filter_has_url:    /url\(/.test(rest?.filter || ''),
  rest_filter_no_brightness: !/brightness\(/.test(rest?.filter || ''),
  rest_brightness_1:      rest?.brightnessAttr === '1',
  rest_hovered_false:     rest?.hoveredAttr === 'false',
  transition_has_filter:  /filter/.test(rest?.transitionProperty || ''),
  source_filter:          sourceFilter,
  source_attr:            sourceAttr,
  source_transition:      sourceTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R584 status-ring brightness (23rd anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
