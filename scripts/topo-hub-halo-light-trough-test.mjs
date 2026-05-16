/* Round 405 verification: hub-halo LIGHT trough 0.32 → 0.34 —
 * symmetrizes R404 cyber treatment across both themes. Probes
 * both cyber and light theme states via two browser contexts.
 *
 * Contract:
 *   - Idle fixture (workingCount=0, bucket=0):
 *     * cyber: data-topo-hub-halo-trough === '0.1' (R404 invariant)
 *     * light: data-topo-hub-halo-trough === '0.34' (R405 lift)
 *     * both: data-hub-busyness === '0'
 *     * both: data-topo-hub-halo-peak per-theme invariant
 *       (cyber 0.16, light 0.52)
 *   - Source-file verification:
 *     * const troughLight = 0.34;
 *     * const troughDark  = 0.10;
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

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
  await page.waitForSelector('[data-hub-busyness]', { timeout: 15000 });
  await page.waitForTimeout(400);
  const probe = await page.evaluate(() => {
    const halo = document.querySelector('[data-hub-busyness]');
    if (!halo) return null;
    return {
      busyness: halo.getAttribute('data-hub-busyness'),
      trough:   halo.getAttribute('data-topo-hub-halo-trough'),
      peak:     halo.getAttribute('data-topo-hub-halo-peak'),
      fill:     halo.getAttribute('fill'),
    };
  });
  await browser.close();
  return probe;
}

const cyber = await probeTheme('cyber');
const light = await probeTheme('light');

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceLight034 = /const troughLight\s*=\s*0\.34;/.test(fileText);
const sourceDark010  = /const troughDark\s*=\s*0\.10;/.test(fileText);
const sourceLightPeak = /const peakLight\s*=\s*\[0\.52, 0\.58, 0\.65, 0\.72\]\[busy\];/.test(fileText);

const results = {
  // Cyber R404 invariant
  cyber_busy_0:           cyber?.busyness === '0',
  cyber_trough_0_1:       cyber?.trough === '0.1',
  cyber_peak_0_16:        cyber?.peak === '0.16',
  cyber_fill_dark:        cyber?.fill === '#10b981',
  // Light R405 lift
  light_busy_0:           light?.busyness === '0',
  light_trough_0_34:      light?.trough === '0.34',
  light_peak_0_52:        light?.peak === '0.52',
  light_fill_light:       light?.fill === '#d1fae5',
  // Source-file canonical wire
  source_light_034:       sourceLight034,
  source_dark_010:        sourceDark010,
  source_light_peak:      sourceLightPeak,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub-halo light trough 0.32 → 0.34:`, JSON.stringify(results),
  '\n  cyber:', cyber,
  '\n  light:', light);
process.exit(ok ? 0 : 1);
