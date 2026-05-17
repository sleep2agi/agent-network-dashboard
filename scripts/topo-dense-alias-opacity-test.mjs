/* Round 452 verification: dense plain-text alias rest opacity 0.9 → 0.95.
 * Sibling to R449/R450 canvas-presence alpha-gap closures.
 *
 * Contract:
 *   - need >16 sessions to enter dense layout
 *   - every dense alias-text reports opacity '0.95' + -opacity attr '0.95'
 *   - source-file probe confirms the value
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
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
  // 20 nodes — crosses the >16 dense threshold
  const sessions = [];
  for (let i = 0; i < 20; i++) {
    sessions.push(mk(`n${String(i).padStart(2, '0')}`, i % 3 === 0 ? 'working' : 'idle'));
  }
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-node-dense-alias-text]', { timeout: 15000 });
await page.waitForTimeout(400);

const aliases = await page.evaluate(() => {
  const ts = [...document.querySelectorAll('[data-node-dense-alias-text]')];
  return ts.map(t => ({
    alias:    t.getAttribute('data-node-dense-alias-text'),
    opacity:  t.getAttribute('opacity'),
    data_op:  t.getAttribute('data-node-dense-alias-text-opacity'),
  }));
});

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /opacity=\{0\.95\}/.test(fileText) && /data-node-dense-alias-text-opacity="0\.95"/.test(fileText);

await browser.close();

const results = {
  dense_layout_count_ge_17: aliases.length >= 17,
  all_opacity_0_95:         aliases.every(a => a.opacity === '0.95'),
  all_data_op_0_95:         aliases.every(a => a.data_op === '0.95'),
  source_wired:             sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} dense alias opacity 0.95:`, JSON.stringify(results),
  '\n  count:', aliases.length, 'sample:', JSON.stringify(aliases[0]));
process.exit(ok ? 0 : 1);
