/* Round 148 verification: recent-signal row gains a <title> tooltip
 * exposing full message context — the row text truncates aliases to
 * 6 chars (R127) and content to 8, useful for scan-density but
 * obscures detail. Native SVG <title> reveals the full alias /
 * content / timestamp on hover. Pinned vs unpinned switches the
 * click-hint so the user knows the next gesture's effect.
 *
 * Mirrors R98's enriched node tooltip at the per-row scope.
 *
 * Fleet: alpha sends 12 msgs to beta-with-long-name (HOT), and
 * beta-with-long-name sends 4 msgs to gamma (warm). Content is
 * a long string to verify untruncated display.
 *
 * States tested:
 *   - hot row: title contains full from / to / msg count + "hot lane"
 *     marker + full content + ISO timestamp + pin hint
 *   - warm row: same shape minus the "hot lane" marker
 *   - pinned: click-hint flips to "click to release pin"
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

// Aliases longer than the row truncation cap (6) so the title's
// untruncated form is meaningfully different from what's painted.
const aliasA = 'alpha-runner';
const aliasB = 'beta-with-long-name';
const aliasC = 'gamma';
const longContent = 'this is the full long message body that the row truncates';

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
    mk(aliasA, 'working'), mk(aliasB, 'working'), mk(aliasC, 'idle'),
  ] } });
});

const now = Date.now();
const mkMsg = (id, from, to, ageMs) => ({
  id, from_alias: from, to_alias: to, content: longContent,
  network_id: 'default', created_at: new Date(now - ageMs).toISOString(),
});
const msgs = [];
// 12 alpha→beta = HOT
for (let i = 0; i < 12; i++) msgs.push(mkMsg(`a${i}`, aliasA, aliasB, 20000 + i * 500));
// 4 beta→gamma = warm
for (let i = 0; i < 4; i++)  msgs.push(mkMsg(`b${i}`, aliasB, aliasC, 30000 + i * 500));
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector(`[data-recent-row="${aliasA}->${aliasB}"]`, { timeout: 10000 });
await page.waitForTimeout(400);

const readTitle = (key) => page.evaluate((k) => {
  const row = document.querySelector(`[data-recent-row="${k}"]`);
  return row?.querySelector('title')?.textContent || '';
}, key);

const hotTitle  = await readTitle(`${aliasA}->${aliasB}`);
const warmTitle = await readTitle(`${aliasB}->${aliasC}`);

// Pin the hot row → title's click-hint flips
await page.locator(`[data-recent-row="${aliasA}->${aliasB}"]`).click();
await page.waitForTimeout(200);
const pinnedTitle = await readTitle(`${aliasA}->${aliasB}`);

await browser.close();

const results = {
  // Hot row
  hot_hasFullFrom:     hotTitle.includes(aliasA),
  hot_hasFullTo:       hotTitle.includes(aliasB),
  hot_hasCount12:      hotTitle.includes('12 msgs'),
  hot_hasHotMarker:    hotTitle.includes('hot lane'),
  hot_hasFullContent:  hotTitle.includes(longContent),
  hot_hasTimestamp:    /last: \d/.test(hotTitle),
  hot_pinHint:         hotTitle.includes('click to pin'),

  // Warm row
  warm_hasCount4:      warmTitle.includes('4 msgs'),
  warm_noHotMarker:    !warmTitle.includes('hot lane'),
  warm_pinHint:        warmTitle.includes('click to pin'),

  // Pinned row's title flips hint
  pinned_releaseHint:  pinnedTitle.includes('click to release pin'),
  pinned_noPinHint:    !pinnedTitle.includes('click to pin · hover to preview'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row title:`, JSON.stringify(results),
  `\n  hotTitle:\n${hotTitle}`,
  `\n  warmTitle:\n${warmTitle}`,
  `\n  pinnedTitle:\n${pinnedTitle}`);
process.exit(ok ? 0 : 1);
