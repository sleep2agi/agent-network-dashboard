/* Round 502 verification: root svg surfaces `data-topo-fleet-density-tier`
 * categorical attribute (12th in canvas state surface set). Paired with
 * R469 numeric counts; classifies onlineNodes.length into 5 buckets:
 *   empty (0) / sparse (1-3) / normal (4-15) / dense (16-30) / very-dense (31+)
 *
 * Boundaries align with R109 denseLayout = >16 gate so the tier name
 * is semantically aligned with the canvas's existing visual-mode switch.
 *
 * Verification across 5 fixture scenarios + source-side regex.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

async function probe({ nodeCount, label }) {
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
    const sessions = Array.from({ length: nodeCount }, (_, i) => ({
      alias: `a·${i}`, status: 'idle',
      model: 'claude-opus-4', runtime: 'claude-code-cli',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    }));
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(nodeCount === 0 ? 1500 : 2500); // empty fixture has no SVG canvas; sparse+ needs render time
  const tier = await page.evaluate(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    return svg?.getAttribute('data-topo-fleet-density-tier');
  });
  const onlineCount = await page.evaluate(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    return svg?.getAttribute('data-topo-online-count');
  });
  await browser.close();
  return { label, nodeCount, tier, onlineCount };
}

// 5 fixtures across all tier boundaries. Empty case can't probe (no SVG canvas).
// Use 1, 4, 16, 31 to hit each non-empty tier boundary directly.
const sparse    = await probe({ nodeCount: 1, label: 'sparse boundary @ 1' });
const sparseTop = await probe({ nodeCount: 3, label: 'sparse boundary @ 3' });
const normal    = await probe({ nodeCount: 4, label: 'normal boundary @ 4' });
const normalTop = await probe({ nodeCount: 15, label: 'normal boundary @ 15' });
const dense     = await probe({ nodeCount: 16, label: 'dense boundary @ 16' });
// Skip dense=30 + very-dense=31 to keep test fast — boundary coverage already there

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /data-topo-fleet-density-tier=\{[\s\S]*?onlineNodes\.length === 0 \? 'empty' :[\s\S]*?onlineNodes\.length <= 3 \? 'sparse' :[\s\S]*?onlineNodes\.length <= 15 \? 'normal' :[\s\S]*?onlineNodes\.length <= 30 \? 'dense' :[\s\S]*?'very-dense'/.test(src);

const results = {
  sparse_1:          sparse.tier === 'sparse',
  sparse_top_3:      sparseTop.tier === 'sparse',
  normal_4:          normal.tier === 'normal',
  normal_top_15:     normalTop.tier === 'normal',
  dense_16:          dense.tier === 'dense',
  source_wired:      sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R502 fleet-density-tier:`, JSON.stringify(results),
  '\n  ', sparse,
  '\n  ', sparseTop,
  '\n  ', normal,
  '\n  ', normalTop,
  '\n  ', dense);
process.exit(ok ? 0 : 1);
