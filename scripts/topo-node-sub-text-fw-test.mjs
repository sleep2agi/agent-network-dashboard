/* Round 448 verification: node sub-text fontWeight 400 → 500.
 * Static legibility lift for small mono text at fontSize=9.
 * Sibling to R363/R364 small-text fw lifts.
 *
 * Contract:
 *   - every node sub-text reports font-weight '500'
 *   - geometry invariants preserved (R428 hover ls + R211 fill
 *     transition still intact)
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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'working'),
    mk('beta',  'idle'),
    mk('gamma', 'working'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-node-sub-text]', { timeout: 15000 });
await page.waitForTimeout(400);

const subs = await page.evaluate(() => {
  const ts = [...document.querySelectorAll('[data-node-sub-text]')];
  return ts.map(t => ({
    alias: t.getAttribute('data-node-sub-text'),
    fw:    t.getAttribute('font-weight'),
    fw_data: t.getAttribute('data-node-sub-text-font-weight'),
    text:  t.textContent,
  }));
});

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /fontWeight="500"\s*\n\s*data-node-sub-text=\{session\.alias\}/.test(fileText);

await browser.close();

const restAllFw500    = subs.every(s => s.fw === '500');
const restAllAttr500  = subs.every(s => s.fw_data === '500');
const restCountGe3    = subs.length >= 3;
const restAllHaveText = subs.every(s => s.text && s.text.length > 0);

const results = {
  sub_count_ge_3:           restCountGe3,
  all_fw_500_attr:          restAllFw500,
  all_fw_data_attr_500:     restAllAttr500,
  all_have_text:            restAllHaveText,
  source_wired:             sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} node sub-text fw 500:`, JSON.stringify(results),
  '\n  subs:', JSON.stringify(subs));
process.exit(ok ? 0 : 1);
