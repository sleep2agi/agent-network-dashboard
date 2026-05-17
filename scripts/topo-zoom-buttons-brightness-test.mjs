/* Round 596 verification: chrome zoom +/- segmented buttons
 * gain hover:brightness-[1.15] via Tailwind class. 35th + 36th
 * anchors in per-element brightness family (4th + 5th HTML).
 * Paired-anchor round closing the zoom control trio.
 *
 * Test phases:
 *   1. mock nodes → chrome zoom buttons render
 *   2. rest: filter='none' (CSS hover-only, no React state)
 *   3. computed transition-property contains 'filter'
 *   4. source: hover:brightness-[1.15] in className + arbitrary
 *      transition-property includes filter
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
await page.waitForSelector('[data-topo-chrome-zoom-out]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const zoomOut = document.querySelector('[data-topo-chrome-zoom-out]');
  const zoomIn  = document.querySelector('[data-topo-chrome-zoom-in]');
  if (!zoomOut || !zoomIn) return null;
  return {
    zoomOut: {
      filter: getComputedStyle(zoomOut).filter,
      transitionProperty: getComputedStyle(zoomOut).transitionProperty,
      brightnessHoverAttr: zoomOut.getAttribute('data-topo-chrome-zoom-out-brightness-hover'),
      ariaLabel: zoomOut.getAttribute('aria-label'),
    },
    zoomIn: {
      filter: getComputedStyle(zoomIn).filter,
      transitionProperty: getComputedStyle(zoomIn).transitionProperty,
      brightnessHoverAttr: zoomIn.getAttribute('data-topo-chrome-zoom-in-brightness-hover'),
      ariaLabel: zoomIn.getAttribute('aria-label'),
    },
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceOutFilter = /data-topo-chrome-zoom-out[\s\S]*?hover:brightness-\[1\.15\]/.test(src);
const sourceInFilter  = /data-topo-chrome-zoom-in[\s\S]*?hover:brightness-\[1\.15\]/.test(src);
const sourceOutTransition = /data-topo-chrome-zoom-out[\s\S]*?\[transition-property:color,background-color,transform,filter\]/.test(src);
const sourceInTransition  = /data-topo-chrome-zoom-in[\s\S]*?\[transition-property:color,background-color,transform,filter\]/.test(src);

const results = {
  both_buttons_present:   !!rest,
  out_rest_filter_none:   rest?.zoomOut.filter === 'none',
  in_rest_filter_none:    rest?.zoomIn.filter === 'none',
  out_hover_attr:         rest?.zoomOut.brightnessHoverAttr === '1.15',
  in_hover_attr:          rest?.zoomIn.brightnessHoverAttr === '1.15',
  out_aria_zoom_out:      /zoom out/i.test(rest?.zoomOut.ariaLabel || ''),
  in_aria_zoom_in:        /zoom in/i.test(rest?.zoomIn.ariaLabel || ''),
  out_transition_filter:  /filter/.test(rest?.zoomOut.transitionProperty || ''),
  in_transition_filter:   /filter/.test(rest?.zoomIn.transitionProperty || ''),
  source_out_filter:      sourceOutFilter,
  source_in_filter:       sourceInFilter,
  source_out_transition:  sourceOutTransition,
  source_in_transition:   sourceInTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R596 zoom +/- brightness (35+36th anchors, zoom trio closure):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
