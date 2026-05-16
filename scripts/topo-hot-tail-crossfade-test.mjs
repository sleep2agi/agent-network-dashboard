/* Round 223 verification: recent-signal panel header hot-tail tspan
 * ("· N hot") always-mounts; visibility crossfades via opacity gate
 * instead of conditional mount/unmount on hotFlowCount > 0. R190's
 * anet-fade-in entrance is preserved; R223 makes the EXIT also ease.
 *
 * Test scenarios:
 *   A. 0 hot flows (all counts < 10):
 *      · tspan IN DOM (always-mount proven)
 *      · data-recent-panel-hot-visible='false'
 *      · opacity attribute = 0
 *      · text content empty (no "· 0 hot" artifact)
 *   B. 1 hot flow (count=12):
 *      · visible='true', opacity=1
 *      · text content matches "· 1 hot"
 *      · anet-fade-in className retained for R190 compat
 *   Both: inline style.transition includes 'opacity 300ms'.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function setup(messages) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
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
      alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    await route.fulfill({ response: r, json: { ...b, sessions: [
      mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
    ] } });
  });
  await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages } }));
  await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
  await page.waitForSelector('[data-recent-panel-hot-count]', { timeout: 10000, state: 'attached' });
  await page.waitForTimeout(400);
  return page;
}

const probe = async (page) => page.evaluate(() => {
  const tail = document.querySelector('[data-recent-panel-hot-count]');
  if (!tail) return null;
  return {
    present:     true,
    visible:     tail.getAttribute('data-recent-panel-hot-visible'),
    count:       tail.getAttribute('data-recent-panel-hot-count'),
    opacity:     parseFloat(tail.getAttribute('opacity') || ''),
    text:        tail.textContent,
    className:   tail.getAttribute('class') || '',
    transition:  tail.style.transition,
  };
});

const now = Date.now();

// Scenario A: 0 hot flows — 1 cold flow with 3 messages (still cold, < 10)
const coldMsgs = [];
for (let i = 0; i < 3; i++) {
  coldMsgs.push({
    id: `cold${i}`, from_alias: 'alpha', to_alias: 'beta', content: 'hi',
    network_id: 'default', created_at: new Date(now - (1000 + i * 50)).toISOString(),
  });
}
const pageA = await setup(coldMsgs);
const probeA = await probe(pageA);
await pageA.close();

// Scenario B: 1 hot flow — 12 messages from alpha to beta
const hotMsgs = [];
for (let i = 0; i < 12; i++) {
  hotMsgs.push({
    id: `hot${i}`, from_alias: 'alpha', to_alias: 'beta', content: 'hi',
    network_id: 'default', created_at: new Date(now - (1000 + i * 50)).toISOString(),
  });
}
const pageB = await setup(hotMsgs);
const probeB = await probe(pageB);
await pageB.close();
await browser.close();

const results = {
  // A: 0 hot flows — tspan in DOM but hidden
  A_present_in_dom:       probeA?.present === true,
  A_visible_false:        probeA?.visible === 'false',
  A_opacity_0:            probeA?.opacity === 0,
  A_text_empty:           probeA?.text === '' || probeA?.text === null,
  A_count_attr_0:         probeA?.count === '0',
  A_has_transition:       /opacity\s+(?:300ms|0\.3s)/.test(probeA?.transition || ''),

  // B: 1 hot flow — visible
  B_present_in_dom:       probeB?.present === true,
  B_visible_true:         probeB?.visible === 'true',
  B_opacity_1:            probeB?.opacity === 1,
  B_text_one_hot:         /·\s*1\s*hot/.test(probeB?.text || ''),
  B_count_attr_1:         probeB?.count === '1',
  B_fade_class_present:   (probeB?.className || '').split(/\s+/).includes('anet-fade-in'),
  B_has_transition:       /opacity\s+(?:300ms|0\.3s)/.test(probeB?.transition || ''),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hot-tail crossfade:`, JSON.stringify(results),
  `\n  probeA (0 hot):`, probeA,
  `\n  probeB (1 hot):`, probeB);
process.exit(ok ? 0 : 1);
