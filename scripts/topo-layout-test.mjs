/* Issue #87 verification: ring | grid layout toggle on TopoGraph.
 * Checks: toggle switches positions, ring ambiance hides in grid, layout
 * persists to localStorage, node click still opens chat in grid mode. */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
mkdirSync('/tmp/anet-issue-87', { recursive: true });
const browser = await chromium.launch({ headless: true });

async function run(nodeCount, label) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  // NB: addInitScript runs on every load incl. reloads — must NOT touch
  // anet-topo-layout here or it'd wipe the persisted value the reload test
  // checks. A fresh context already starts with empty localStorage.
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
localStorage.setItem('anet-topo-nodescale', '1');
      localStorage.removeItem('anet-brand');
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  });
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const fleet = Array.from({ length: nodeCount }, (_, i) => ({
      alias: `节点${i + 1}号`, status: i % 4 === 0 ? 'working' : 'idle', network_id: nid,
      created_at: '2026-05-14T00:00:00Z', updated_at: '2026-05-14T00:00:00Z', last_seen_at: '2026-05-14T00:00:00Z',
    }));
    await route.fulfill({ response: r, json: { ...b, sessions: fleet } });
  });
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    return !!svg && svg.querySelectorAll('circle[r="26"]').length > 0;
  }, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(700);

  const results = {};
  const svgSel = 'svg[viewBox="0 0 1000 680"]';
  // node center positions (status rings cx/cy)
  const positions = () => page.$$eval(`${svgSel} circle[r="26"], ${svgSel} circle[r="18"]`,
    els => els.map(e => `${e.getAttribute('cx')},${e.getAttribute('cy')}`).join('|'));
  // ring ambiance marker: the radar backdrop circle r=330
  const ringAmbiance = () => page.locator(`${svgSel} circle[r="330"]`).count();

  // --- ring mode (default) ---
  results.ringHasAmbiance = (await ringAmbiance()) > 0;
  const ringPos = await positions();

  // --- toggle to grid ---
  await page.locator('button', { hasText: 'Grid' }).click();
  await page.waitForTimeout(400);
  const gridPos = await positions();
  results.toggledPositions = ringPos !== gridPos && gridPos.length > 0;
  results.gridHidesAmbiance = (await ringAmbiance()) === 0;
  results.persistedGrid = (await page.evaluate(() => localStorage.getItem('anet-topo-layout'))) === 'grid';

  // grid nodes should sit on a small set of distinct rows (grid = aligned y's)
  results.gridRowsAligned = await page.$$eval(`${svgSel} circle[r="26"], ${svgSel} circle[r="18"]`, els => {
    const ys = els.map(e => Math.round(parseFloat(e.getAttribute('cy'))));
    const distinct = new Set(ys);
    // a grid of N nodes has ⌈√N⌉ rows → far fewer distinct y's than a ring
    return distinct.size <= Math.ceil(Math.sqrt(els.length)) + 1;
  });

  // --- node click still opens chat in grid mode ---
  const ring = page.locator(`${svgSel} circle[r="26"]`).first();
  const bb = await ring.boundingBox();
  if (bb) await page.mouse.wheel(0, bb.y - 160);
  await page.waitForTimeout(150);
  await ring.click({ force: true });
  await page.waitForTimeout(400);
  results.chatWorksInGrid = (await page.locator('[role="dialog"][aria-label^="Chat with"]').count()) === 1;
  await page.screenshot({ path: `/tmp/anet-issue-87/grid-${label}.png` });

  // --- reload: layout persists ---
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    return !!svg && svg.querySelectorAll('circle[r="26"]').length > 0;
  }, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
  results.persistsAcrossReload = (await ringAmbiance()) === 0 &&
    (await page.evaluate(() => localStorage.getItem('anet-topo-layout'))) === 'grid';

  // --- toggle back to ring ---
  await page.locator('button', { hasText: 'Ring' }).click();
  await page.waitForTimeout(400);
  results.ringRestores = (await ringAmbiance()) > 0;

  await ctx.close();
  const ok = results.ringHasAmbiance && results.toggledPositions && results.gridHidesAmbiance &&
    results.persistedGrid && results.gridRowsAligned && results.chatWorksInGrid &&
    results.persistsAcrossReload && results.ringRestores;
  console.log(`${ok ? '✅' : '❌'} [${label}] ${nodeCount} nodes:`, JSON.stringify(results));
  return ok;
}

const all = [];
all.push(await run(6, 'small'));
all.push(await run(22, 'medium'));
all.push(await run(50, 'large'));
await browser.close();
const pass = all.every(Boolean);
console.log(pass ? '\n✅ ALL PASS' : '\n❌ FAIL');
process.exit(pass ? 0 : 1);
