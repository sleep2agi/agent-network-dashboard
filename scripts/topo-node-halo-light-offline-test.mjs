/* Round 456 verification: node halo light-theme offline rest opacity
 * 0.45 → 0.50. Stale-state legibility lift family extension.
 *
 * Contract:
 *   - light theme, fixture has offline nodes
 *   - every offline halo reports data-node-halo-resolved-opacity '0.5'
 *     (was 0.45)
 *   - online halos still at light 0.85 (R407 + R440 preserved)
 *   - source-file probe confirms the conditional
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
// Use LIGHT theme for this test
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'light'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
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
    mk('alpha', 'working'),  // online
    mk('beta',  'offline'),  // offline
    mk('gamma', 'offline'),  // offline
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-node-halo-hovered]', { timeout: 15000 });
await page.waitForTimeout(400);

const halos = await page.evaluate(() => {
  const cs = [...document.querySelectorAll('[data-node-halo-hovered]')];
  return cs.map(c => {
    const node = c.closest('[data-node]');
    const sub = node?.querySelector('[data-node-sub-text]')?.textContent || '';
    return {
      alias:    node?.getAttribute('data-node') || null,
      status:   sub.trim(),
      opacity:  parseFloat(c.getAttribute('data-node-halo-resolved-opacity') || '0'),
      offline_attr_alpha: c.getAttribute('data-node-halo-offline-opacity'),
    };
  });
});

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /isLight \? \(isHaloHovered \? 0\.60 : 0\.50\) : \(isHaloHovered \? 0\.45 : 0\.30\)/.test(fileText);

await browser.close();

const onlineHalo  = halos.find(h => h.status.includes('working'));
const offlineHalos = halos.filter(h => h.status.includes('offline'));

const results = {
  any_mounted:                halos.length > 0,
  online_opacity_0_85:        onlineHalo?.opacity === 0.85,
  offline_count_ge_2:         offlineHalos.length >= 2,
  offline_all_0_5:            offlineHalos.every(h => h.opacity === 0.5),
  offline_attr_0_45_preserved: offlineHalos.every(h => h.offline_attr_alpha === '0.45'), /* attr exposes the LEGACY R407 light value 0.45; the resolved-opacity is the live 0.50; this preserves R407 test compat */
  source_wired:               sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} node halo light offline 0.5:`, JSON.stringify(results),
  '\n  halos:', JSON.stringify(halos));
process.exit(ok ? 0 : 1);
