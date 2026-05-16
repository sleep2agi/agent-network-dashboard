/* Round 387 verification: hover-detail panel cyber rest opacity
 * 0.94 → 0.97. Theme-consistency / canvas-presence polish family
 * (5th anchor) after R370 hub-ring 0.7→0.8 cyber, R371 edge-badge
 * 0.82→0.85 cyber, R372 minimap offline 0.5→0.6, R386 hub-highlight
 * idle 0.9→0.95. Unifies the active-hover product card's cyber
 * backdrop with the R348 recent-signal/legend panel HOVER state
 * (0.97 cyber) so all active-hover panels paint with the same
 * confident backdrop.
 *
 * Contract:
 *   - On hover, the hover-detail panel mounts and:
 *     * <rect> opacity attr === '0.97' (cyber theme)
 *     * data-topo-hover-detail-opacity === '0.97' (cyber theme)
 *   - Pre-R387 invariants preserved:
 *     * <rect> rx === '8'
 *     * <rect> stroke is non-empty (pal.legendAccent)
 *     * data-topo-hover-detail is present (alias-keyed)
 *     * R348 drop-shadow filter is present
 *   - Light theme stays at opacity 0.98 (separately tested below).
 *
 * Fixture: 2 idle sessions so hover-detail mounts cleanly without
 * the dense-layout >16-node gate (R387 inherits the same gate).
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

async function probeWith(theme) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('anet-theme', t); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
  }, theme);
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const mk = (alias) => ({
      alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta') ] } });
  });
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('g[data-node]', { timeout: 15000 });
  await page.waitForTimeout(300);
  // Hover the first node to mount hover-detail
  await page.hover('g[data-node]');
  await page.waitForSelector('[data-topo-hover-detail]', { timeout: 5000 });
  await page.waitForTimeout(300);
  const probe = await page.evaluate(() => {
    const card = document.querySelector('[data-topo-hover-detail]');
    if (!card) return null;
    const rect = card.querySelector('rect');
    return {
      alias:       card.getAttribute('data-topo-hover-detail'),
      opacityAttr: rect?.getAttribute('opacity') ?? null,
      opacityData: rect?.getAttribute('data-topo-hover-detail-opacity') ?? null,
      rxAttr:      rect?.getAttribute('rx') ?? null,
      strokeAttr:  rect?.getAttribute('stroke') ?? null,
      filterStyle: rect?.getAttribute('style') ?? '',
    };
  });
  await browser.close();
  return probe;
}

const cyber = await probeWith('cyber');
const light = await probeWith('light');

const results = {
  // Cyber: lifted from 0.94 → 0.97
  cyber_opacity_attr_0_97:    cyber?.opacityAttr === '0.97',
  cyber_opacity_data_0_97:    cyber?.opacityData === '0.97',
  // Light: stays at 0.98 (R387 doesn't touch light)
  light_opacity_attr_0_98:    light?.opacityAttr === '0.98',
  light_opacity_data_0_98:    light?.opacityData === '0.98',
  // Pre-R387 invariants on both themes
  cyber_rx_8:                 cyber?.rxAttr === '8',
  light_rx_8:                 light?.rxAttr === '8',
  cyber_stroke_present:       !!cyber?.strokeAttr && cyber.strokeAttr !== 'none',
  light_stroke_present:       !!light?.strokeAttr && light.strokeAttr !== 'none',
  cyber_drop_shadow:          cyber?.filterStyle.includes('drop-shadow'),
  light_drop_shadow:          light?.filterStyle.includes('drop-shadow'),
  cyber_alias_present:        !!cyber?.alias && cyber.alias.length > 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hover-detail panel cyber opacity 0.94 → 0.97:`, JSON.stringify(results),
  '\n  cyber:', cyber,
  '\n  light:', light);
process.exit(ok ? 0 : 1);
