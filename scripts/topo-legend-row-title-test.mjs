/* Round 149 verification: legend rows gain a <title> tooltip
 * symmetric with R148's recent-signal row tooltip. Closes the
 * R97 idiom on the panel side — anywhere the UI shows "N" should
 * hover-explain WHICH N.
 *
 * Both side panels now have matching row-tooltip affordances:
 *   recent-signal row (R148): full from/to/timestamp/content + pin hint
 *   legend row       (R149): status label + matched-aliases + pin hint
 *
 * Fleet: 3 working / 2 idle / 1 offline so all three bucket rows
 * show non-zero. Verify each row's title contains:
 *   - status label + count
 *   - alias list of matching nodes
 *   - "click to pin" hint when not pinned
 *
 * Then click idle to pin → title flips to "click to release pin".
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
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('worker-a', 'working'), mk('worker-b', 'working'), mk('worker-c', 'working'),
    mk('idle-a',   'idle'),    mk('idle-b',   'idle'),
    mk('off-a',    'offline'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
// 3 working + 2 idle + 1 offline = 6 sessions; offline nodes still
// render as g[data-node] (line ~2754 [...onlineNodes, ...offlineNodes]
// .map). Initial count check was off-by-one.
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 6, { timeout: 30000 });
await page.waitForSelector('[data-legend-status="working"]', { timeout: 10000 });
await page.waitForTimeout(400);

const readTitle = (key) => page.evaluate((k) => {
  const row = document.querySelector(`[data-legend-status="${k}"]`);
  return row?.querySelector('title')?.textContent || '';
}, key);

const wTitle = await readTitle('working');
const iTitle = await readTitle('idle');
const oTitle = await readTitle('offline');

// Pin idle → its title flips
await page.locator('[data-legend-status="idle"]').click();
await page.waitForTimeout(200);
const iPinnedTitle = await readTitle('idle');

await browser.close();

const results = {
  // Working row: 3 working aliases
  w_hasLabel:        wTitle.includes('working node · 3'),
  w_hasWorkerA:      wTitle.includes('worker-a'),
  w_hasWorkerB:      wTitle.includes('worker-b'),
  w_hasWorkerC:      wTitle.includes('worker-c'),
  w_pinHint:         wTitle.includes('click to pin'),

  // Idle row: 2 idle aliases
  i_hasLabel:        iTitle.includes('online idle · 2'),
  i_hasIdleA:        iTitle.includes('idle-a'),
  i_hasIdleB:        iTitle.includes('idle-b'),
  i_pinHint:         iTitle.includes('click to pin'),

  // Offline row: 1 offline alias
  o_hasLabel:        oTitle.includes('offline / no SSE · 1'),
  o_hasOffA:         oTitle.includes('off-a'),

  // After pin: title hint flipped
  iPinned_releaseHint: iPinnedTitle.includes('click to release pin'),
  iPinned_noPinHint:   !iPinnedTitle.includes('click to pin · hover to preview'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend-row title:`, JSON.stringify(results),
  `\n  workingTitle:\n${wTitle}`,
  `\n  idleTitle:\n${iTitle}`,
  `\n  offlineTitle:\n${oTitle}`,
  `\n  idlePinnedTitle:\n${iPinnedTitle}`);
process.exit(ok ? 0 : 1);
