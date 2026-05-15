/* Issue #84 verification: node.renamed SSE handler.
 * Mocks the SSE stream + status API so a node.renamed event flips the
 * topology node old→new alias instantly, and an open chat popover follows
 * the rename instead of pointing at a dead alias. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const OLD = '节点旧名', NEW = '节点新名';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
localStorage.setItem('anet-topo-nodescale', '1');
    localStorage.removeItem('anet-brand');
    localStorage.removeItem('anet-topo-view');
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});

// shared test state
let fireRename = false;   // test arms this once the old-name node is confirmed
let renamed = false;      // flips true the moment the rename event is served

// status: old alias before rename, new alias after
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const alias = renamed ? NEW : OLD;
  await route.fulfill({ response: r, json: { ...b, sessions: [
    { alias, status: 'idle', network_id: nid, created_at: '2026-05-15T00:00:00Z', updated_at: '2026-05-15T00:00:00Z', last_seen_at: '2026-05-15T00:00:00Z' },
  ] } });
});
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

// SSE: HEAD probe says "available"; GET serves `connected` until the test
// arms fireRename, then one reconnect later it serves the node.renamed event.
await ctx.route('**/api/hub/events**', async (route) => {
  const req = route.request();
  if (req.method() === 'HEAD') {
    await route.fulfill({ status: 204, headers: { 'x-anet-sse-available': 'true' } });
    return;
  }
  let body = `data: ${JSON.stringify({ type: 'connected', session: 'tester' })}\n\n`;
  if (fireRename && !renamed) {
    renamed = true; // status refetch triggered by the handler now returns NEW
    body += `data: ${JSON.stringify({
      type: 'node.renamed', event: 'node.renamed', alias: NEW,
      txn_id: 'rtxn_test', ts: '2026-05-15T00:00:00Z',
      data: { old_alias: OLD, new_alias: NEW, surfaces_updated: ['config', 'commhub'], history_policy: 'preserve' },
    })}\n\n`;
  }
  await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body });
});

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  return !!svg && svg.querySelectorAll('circle[r="26"]').length > 0;
}, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(600);

const results = {};
const svg = 'svg[viewBox="0 0 1000 680"]';
const nodeTexts = () => page.$$eval(`${svg} text`, els => els.map(e => (e.textContent || '').trim()));

// --- before rename: old alias rendered ---
let texts = await nodeTexts();
results.oldNameShown = texts.includes(OLD);

// open the chat popover on the old-name node
const ring = page.locator(`${svg} circle[r="26"]`).first();
const bb = await ring.boundingBox();
if (bb) await page.mouse.wheel(0, bb.y - 160);
await page.waitForTimeout(150);
await ring.click({ force: true });
await page.waitForTimeout(400);
const popover = page.locator('[role="dialog"][aria-label^="Chat with"]');
results.popoverOpenedOnOld = (await popover.getAttribute('aria-label')) === `Chat with ${OLD}`;

// --- arm the rename, wait for the SSE reconnect to deliver it ---
fireRename = true;
await page.waitForFunction((oldName) => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  if (!svg) return false;
  const txt = [...svg.querySelectorAll('text')].map(t => (t.textContent || '').trim());
  return !txt.includes(oldName);
}, OLD, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(500);

// --- after rename: topology flipped to the new alias ---
texts = await nodeTexts();
results.newNameShown = texts.includes(NEW);
results.oldNameGone = !texts.includes(OLD);
// chat popover followed the rename
results.popoverFollowedRename = (await popover.getAttribute('aria-label').catch(() => null)) === `Chat with ${NEW}`;

await browser.close();
const ok = results.oldNameShown && results.popoverOpenedOnOld &&
  results.newNameShown && results.oldNameGone && results.popoverFollowedRename;
console.log(`${ok ? '✅' : '❌'} node.renamed handler:`, JSON.stringify(results));
process.exit(ok ? 0 : 1);
