/* Round 595 verification: chrome fullscreen button gains filter
 * brightness(1.15) on hoveredFullscreen. 34th anchor in per-
 * element brightness family, 3rd HTML-element anchor. Sibling
 * to R594 reset — closes standalone chrome button pair.
 *
 * Test phases:
 *   1. mock nodes → chrome strip renders Fullscreen button
 *   2. rest (no hover): filter='none', brightness-attr='1'
 *   3. transition-property contains 'filter'
 *   4. source: filter conditional + data-attr + state hook
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
await page.waitForSelector('[data-topo-chrome-fullscreen-brightness]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-chrome-fullscreen-brightness]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    brightnessAttr: el.getAttribute('data-topo-chrome-fullscreen-brightness'),
    hoverAttr: el.getAttribute('data-topo-chrome-fullscreen-hover'),
    activeAttr: el.getAttribute('data-topo-chrome-fullscreen-active'),
    ariaLabel: el.getAttribute('aria-label'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: hoveredFullscreen \? 'brightness\(1\.15\)' : undefined/.test(src);
const sourceAttr = /data-topo-chrome-fullscreen-brightness=\{hoveredFullscreen \? '1\.15' : '1'\}/.test(src);
const sourceState = /const \[hoveredFullscreen, setHoveredFullscreen\] = useState\(false\)/.test(src);
const sourceTransition = /transition: 'color 200ms ease-out, background-color 200ms ease-out, border-color 200ms ease-out, transform 200ms ease-out, filter 200ms ease-out'/.test(src);

const results = {
  button_present:         !!rest,
  rest_filter_none:       rest?.filter === 'none',
  rest_brightness_1:      rest?.brightnessAttr === '1',
  rest_hover_false:       rest?.hoverAttr === 'false',
  is_fullscreen_button:   /fullscreen/i.test(rest?.ariaLabel || ''),
  transition_has_filter:  /filter/.test(rest?.transitionProperty || ''),
  source_filter:          sourceFilter,
  source_attr:            sourceAttr,
  source_state:           sourceState,
  source_transition:      sourceTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R595 fullscreen-button brightness (34th anchor, 3rd HTML, pair-symmetry close):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
