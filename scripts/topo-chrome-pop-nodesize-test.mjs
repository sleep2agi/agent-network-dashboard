/* Round 250 verification: nodeSize S/M/L buttons close the chrome-
 * pop click-feedback family. Every clickable chrome button now fires
 * the R186 .anet-chrome-pop 220ms scale-pulse on release.
 *
 * R171 nodeSizeSwitching canvas crossfade still masks the radius
 * change at the global scope; R250 chrome-pop adds the LOCAL
 * button-level click confirmation.
 *
 * Test scope: click each of S/M/L → within 50ms data-topo-chrome-
 * nodesize-popping='true' + className contains 'anet-chrome-pop'.
 * After 300ms both clear.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
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
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-topo-chrome-nodesize="S"]', { timeout: 10000 });
await page.waitForTimeout(300);

const testButton = async (size) => {
  const sel = `[data-topo-chrome-nodesize="${size}"]`;
  await page.locator(sel).click();
  await page.waitForTimeout(50);
  const duringAttr = await page.locator(sel).getAttribute('data-topo-chrome-nodesize-popping');
  const duringClass = await page.locator(sel).getAttribute('class');
  // Wait past the 240ms TTL
  await page.waitForTimeout(300);
  const afterAttr = await page.locator(sel).getAttribute('data-topo-chrome-nodesize-popping');
  const afterClass = await page.locator(sel).getAttribute('class');
  return {
    size,
    duringAttr,
    duringClassHasPop: /anet-chrome-pop/.test(duringClass || ''),
    afterAttr,
    afterClassHasPop: /anet-chrome-pop/.test(afterClass || ''),
  };
};

// Click each in order S → L → M to mix up state
const small = await testButton('S');
const large = await testButton('L');
const medium = await testButton('M');

await browser.close();

const ok_each = (b) =>
  b.duringAttr === 'true' &&
  b.duringClassHasPop === true &&
  b.afterAttr === 'false' &&
  b.afterClassHasPop === false;

const results = {
  small_pops:  ok_each(small),
  medium_pops: ok_each(medium),
  large_pops:  ok_each(large),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chrome-pop nodesize:`, JSON.stringify(results),
  '\n  small: ', small,
  '\n  medium:', medium,
  '\n  large: ', large);
process.exit(ok ? 0 : 1);
