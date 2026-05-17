/* Round 513 verification: root svg surfaces `data-topo-prefers-reduced-
 * motion` (15th attr in canvas state surface set). Reflects the
 * client's prefers-reduced-motion media-query state.
 *
 * Tests:
 *   1. no-preference: attr='false'
 *   2. reduce:        attr='true'
 *   3. source-side regex confirms wiring
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

async function probe(reducedMotion) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 1200 },
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
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
    const mk = (alias, status) => ({
      alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1', 'idle')] } });
  });
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await page.waitForSelector('svg[data-topo-prefers-reduced-motion]', { timeout: 15000 });
  // Wait for the useEffect that updates reducedMotion via matchMedia listener
  await page.waitForTimeout(800);
  const attr = await page.evaluate(() =>
    document.querySelector('svg[viewBox="0 0 1000 680"]')?.getAttribute('data-topo-prefers-reduced-motion')
  );
  await browser.close();
  return attr;
}

const noPref = await probe(false);
const reduce = await probe(true);

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /data-topo-prefers-reduced-motion=\{reducedMotion \? 'true' : 'false'\}/.test(src);

const results = {
  no_pref_returns_false: noPref === 'false',
  reduce_returns_true:   reduce === 'true',
  source_wired:          sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R513 prefers-reduced-motion attr:`, JSON.stringify(results),
  '\n  no-pref:', noPref, '/ reduce:', reduce);
process.exit(ok ? 0 : 1);
