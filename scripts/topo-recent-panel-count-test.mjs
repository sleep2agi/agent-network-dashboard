/* Round 96 verification: the recent-signal panel header count now
 * reads "X flows" off flowLinks.length (matching the deduped rows
 * below), not "X msgs" off the raw messages.length. Pre-R96 a
 * fleet with 10 messages aggregating to 3 unique pairs read
 * "10 msgs" above only 3 rendered rows — read as broken.
 *
 * Mock 5 messages between 2 distinct pairs: alpha↔beta gets 4
 * msgs (4 separate exchanges, dedupes to 1 flow), gamma→delta
 * gets 1 msg (1 flow). Total = 5 msgs, 2 flows. Header should
 * show "2 flows", panel renders 2 rows.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta'), mk('gamma'), mk('delta')] } });
});

const now = Date.now();
const mkMsg = (id, from_alias, to_alias, content, ageMs) => ({
  id, from_alias, to_alias, content, network_id: 'default',
  created_at: new Date(now - ageMs).toISOString(),
});
// 5 messages → 2 flow pairs (alpha→beta × 4, gamma→delta × 1).
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
  mkMsg('m1', 'alpha', 'beta',  'ping-1', 60 * 1000),
  mkMsg('m2', 'alpha', 'beta',  'ping-2', 50 * 1000),
  mkMsg('m3', 'alpha', 'beta',  'ping-3', 40 * 1000),
  mkMsg('m4', 'alpha', 'beta',  'ping-4', 30 * 1000),
  mkMsg('m5', 'gamma', 'delta', 'hello',  20 * 1000),
] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-recent-panel-count]', { timeout: 10000 });
await page.waitForTimeout(400);

const headerCount  = await page.locator('[data-recent-panel-count]').textContent();
const renderedRows = await page.locator('[data-recent-row]').count();

await browser.close();

const results = {
  header_saysFlowsNotMsgs:  /\bflows\b/.test(headerCount || ''),
  header_count2:            /^2 flows/.test(headerCount || ''),
  rows_match_header:        renderedRows === 2,
  no_msgs_word:             !/\bmsgs?\b/.test(headerCount || ''),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-panel count:`, JSON.stringify(results),
  `\n  header=`,     JSON.stringify(headerCount),
  `\n  rows=`,       renderedRows);
process.exit(ok ? 0 : 1);
