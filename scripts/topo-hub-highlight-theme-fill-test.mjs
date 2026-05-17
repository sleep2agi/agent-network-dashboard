/* Round 509 verification: hub-highlight circle fill switches per theme.
 *   dark/cyber theme:  #d1fae5 (emerald-100, pale)
 *   light theme:       #10b981 (emerald-600, vibrant)
 *
 * Fixes a light-theme contrast issue where pale emerald-100 on a
 * pale background rendered the dim disc effectively invisible.
 *
 * Test scenarios:
 *   1. cyber theme — fill resolves to #d1fae5 (or rgb equivalent)
 *   2. light theme — fill resolves to #10b981 (or rgb equivalent)
 *   3. source-side ternary wired
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

async function probe(theme) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('anet-theme', t);
      localStorage.setItem('anet-topo-layout', 'ring');
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  }, theme);
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const mk = (alias, status) => ({
      alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    // idle fleet so hub-highlight is visible
    await route.fulfill({ response: r, json: { ...b, sessions: [
      mk('alpha·a1', 'idle'),
    ] } });
  });
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-topo-hub-highlight]', { timeout: 15000 });
  await page.waitForTimeout(1500);
  const result = await page.evaluate(() => {
    const circle = document.querySelector('[data-topo-hub-highlight]');
    if (!circle) return null;
    return {
      fill_attr: circle.getAttribute('fill'),
      computed_fill: window.getComputedStyle(circle).fill,
    };
  });
  await browser.close();
  return result;
}

const cyber = await probe('cyber');
const light = await probe('light');

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /fill=\{isLight \? '#10b981' : '#d1fae5'\}/.test(src);

// fill_attr is the actual SVG attribute value (literal '#d1fae5' or '#10b981')
// computed_fill is browser-normalized ('rgb(...)' typically)
const cyberHexMatch = cyber && cyber.fill_attr === '#d1fae5';
const lightHexMatch = light && light.fill_attr === '#10b981';

const results = {
  cyber_fill_d1fae5: cyberHexMatch,
  light_fill_10b981: lightHexMatch,
  themes_differ:    cyber && light && cyber.fill_attr !== light.fill_attr,
  source_wired:     sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R509 hub-highlight theme fill:`, JSON.stringify(results),
  '\n  cyber:', JSON.stringify(cyber),
  '\n  light:', JSON.stringify(light));
process.exit(ok ? 0 : 1);
