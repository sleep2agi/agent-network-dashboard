/* Round 407 verification: node halo offline opacity lift — cyber
 * 0.25 → 0.30 and light 0.4 → 0.45. Probes both themes via two
 * browser contexts with a single offline (ghost) session.
 *
 * Contract:
 *   - Online node (status: idle): opacity '0.65' cyber / '0.85' light
 *     (unchanged by R407 — invariant probe)
 *   - Offline node (status: offline + stale last_seen_at):
 *     * cyber: opacity attr === '0.3'
 *     * light: opacity attr === '0.45'
 *     * data-node-halo-offline-opacity === '0.3' / '0.45'
 *   - Source-file verification: the conditional
 *     `(isLight ? 0.45 : 0.30)` is present.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString();

async function probeTheme(theme) {
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
    await route.fulfill({ response: r, json: { ...b, sessions: [
      { alias: 'alpha', status: 'idle',    model: 'claude-opus-4', runtime: 'claude-code-cli', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
      { alias: 'ghost', status: 'offline', model: 'claude-opus-4', runtime: 'claude-code-cli', network_id: nid, project_dir: null, created_at: stale, updated_at: stale, last_seen_at: stale },
    ] } });
  });
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('g[data-node]', { timeout: 15000 });
  await page.waitForTimeout(400);
  const probe = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('g[data-node]'));
    const read = (alias) => {
      const node = nodes.find((n) => n.getAttribute('data-node') === alias);
      if (!node) return null;
      const halo = node.querySelector('[data-node-halo-breath]');
      return halo ? {
        opacityAttr: halo.getAttribute('opacity'),
        offlineData: halo.getAttribute('data-node-halo-offline-opacity'),
      } : null;
    };
    return {
      online: read('alpha'),
      offline: read('ghost'),
    };
  });
  await browser.close();
  return probe;
}

const cyber = await probeTheme('cyber');
const light = await probeTheme('light');

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceHasOfflineLift = /isOnline\s*\?\s*\(isLight\s*\?\s*0\.85\s*:\s*0\.65\)\s*:\s*\(isLight\s*\?\s*0\.45\s*:\s*0\.30\)/.test(fileText);

const results = {
  // Online (R407 doesn't touch online — invariant)
  cyber_online_065:           cyber?.online?.opacityAttr === '0.65',
  light_online_085:           light?.online?.opacityAttr === '0.85',
  cyber_online_no_offline_attr: cyber?.online?.offlineData === null || cyber?.online?.offlineData === undefined,
  // Offline (R407 lift)
  cyber_offline_0_3:          cyber?.offline?.opacityAttr === '0.3',
  cyber_offline_data_0_3:     cyber?.offline?.offlineData === '0.3',
  light_offline_0_45:         light?.offline?.opacityAttr === '0.45',
  light_offline_data_0_45:    light?.offline?.offlineData === '0.45',
  // Source-file verification
  source_offline_lift:        sourceHasOfflineLift,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} node halo offline opacity lift:`, JSON.stringify(results),
  '\n  cyber:', cyber,
  '\n  light:', light);
process.exit(ok ? 0 : 1);
