/* Issue #100 verification: click a topology node avatar → draggable singleton
 * ChatPopover. Tests open / drag / singleton-switch / close at 1, 5, 50 nodes.
 *
 * Node groups carry style="cursor:pointer"; clicking the <g> auto-scrolls it
 * into view and lands on the avatar text/circle, which bubbles to the <g>'s
 * onClick — the same path a real user click takes. */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
mkdirSync('/tmp/anet-issue-100', { recursive: true });
const browser = await chromium.launch({ headless: true });

async function run(nodeCount, viewport, label) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
localStorage.setItem('anet-topo-nodescale', '1');
      localStorage.removeItem('anet-brand');
      localStorage.removeItem('anet-topo-view');
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
  await page.waitForTimeout(800);
  // Below 1024px the topology is collapsed behind a "Show Topology" toggle.
  const showBtn = page.locator('button', { hasText: 'Show Topology' });
  if (await showBtn.count()) await showBtn.first().click();
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    return !!svg && svg.querySelectorAll('circle[r="26"]').length > 0;
  }, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);

  const results = {};
  // The avatar status ring; force-click lands on the overlaying initial text,
  // which bubbles to the node <g>'s onClick — the real-user click path.
  const rings = page.locator('svg[viewBox="0 0 1000 680"] circle[r="26"]');
  results.nodeCount = await rings.count();
  // Scroll so the ring sits in the top quarter of the viewport, clear of a
  // low-docked popover, then force-click it.
  const clickNode = async (i) => {
    const ring = rings.nth(i);
    const b = await ring.boundingBox();
    if (b) await page.mouse.wheel(0, b.y - 120);
    await page.waitForTimeout(150);
    await ring.click({ force: true });
  };

  // --- open: click first node ---
  await clickNode(0);
  await page.waitForTimeout(400);
  const popover = page.locator('[role="dialog"][aria-label^="Chat with"]');
  results.opensOnClick = (await popover.count()) === 1;
  const alias1 = await popover.getAttribute('aria-label').catch(() => null);

  // --- drag: grab header, move up-left (room on both desktop top-anchor and
  //     mobile low-dock), confirm position changed ---
  const box0 = await popover.boundingBox();
  const header = popover.locator('div').first();
  const hb = await header.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + 14);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 - 100, hb.y + 14 - 150, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const box1 = await popover.boundingBox();
  results.draggable = !!(box1 && box0) && (Math.abs(box1.x - box0.x) > 40 || Math.abs(box1.y - box0.y) > 40);

  // --- resize: drag the bottom-right handle, confirm w/h changed (#106) ---
  const sizeBefore = await popover.boundingBox();
  const handle = popover.locator('[aria-label="Resize chat"]');
  const grip = await handle.boundingBox();
  // First shrink (drag handle up-left), then the popover dimensions shrink.
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x - 60, grip.y - 80, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const sizeAfter = await popover.boundingBox();
  results.resizable = !!(sizeBefore && sizeAfter) &&
    (Math.abs(sizeAfter.width - sizeBefore.width) > 20 || Math.abs(sizeAfter.height - sizeBefore.height) > 20);
  // resize must not have spawned a second popover or closed it
  results.resizeKeepsSingle = (await popover.count()) === 1;

  // --- singleton switch: park the popover at the bottom, then tap another
  //     node in the now-exposed upper area; still ONE popover, alias changed ---
  if (results.nodeCount > 1) {
    const hb2 = await header.boundingBox();
    await page.mouse.move(hb2.x + hb2.width / 2, hb2.y + 14);
    await page.mouse.down();
    await page.mouse.move(hb2.x + hb2.width / 2, viewport.height, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    await clickNode(1);
    await page.waitForTimeout(400);
    results.stillSingle = (await popover.count()) === 1;
    const alias2 = await popover.getAttribute('aria-label').catch(() => null);
    results.switchesAlias = !!alias2 && alias1 !== alias2;
  } else {
    results.stillSingle = (await popover.count()) === 1;
    results.switchesAlias = 'n/a';
  }

  await page.screenshot({ path: `/tmp/anet-issue-100/popover-${label}.png` });

  // --- close ---
  await popover.locator('button[aria-label="Close chat"]').click();
  await page.waitForTimeout(300);
  results.closes = (await popover.count()) === 0;

  await ctx.close();
  const ok = results.opensOnClick && results.draggable && results.resizable &&
    results.resizeKeepsSingle && results.stillSingle &&
    (results.switchesAlias === true || results.switchesAlias === 'n/a') && results.closes;
  console.log(`${ok ? '✅' : '❌'} [${label}] ${nodeCount}n ${viewport.width}x${viewport.height}:`, JSON.stringify(results));
  return ok;
}

// #106 addendum: the popover must work while the topology is fullscreen.
// It's rendered inside the fullscreen container, so it must end up as a
// descendant of document.fullscreenElement and still open / drag / resize.
async function runFullscreen() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-topo-nodescale', '1');
      localStorage.removeItem('anet-brand');
      localStorage.removeItem('anet-topo-view');
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  });
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const fleet = Array.from({ length: 5 }, (_, i) => ({
      alias: `节点${i + 1}号`, status: 'idle', network_id: nid,
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
  await page.waitForTimeout(600);

  const results = {};
  // enter fullscreen on the topology container
  await page.locator('button[aria-label="Enter fullscreen"]').click();
  await page.waitForTimeout(500);
  results.enteredFullscreen = await page.evaluate(() => !!document.fullscreenElement);

  // open the popover by clicking a node
  const ring = page.locator('svg[viewBox="0 0 1000 680"] circle[r="26"]').first();
  const b = await ring.boundingBox();
  if (b) await page.mouse.wheel(0, b.y - 200);
  await page.waitForTimeout(150);
  await ring.click({ force: true });
  await page.waitForTimeout(400);
  const popover = page.locator('[role="dialog"][aria-label^="Chat with"]');
  results.opensInFullscreen = (await popover.count()) === 1;
  // the popover must be inside the fullscreen element, else it's invisible
  results.insideFullscreenLayer = await page.evaluate(() => {
    const fs = document.fullscreenElement;
    const pop = document.querySelector('[role="dialog"][aria-label^="Chat with"]');
    return !!fs && !!pop && fs.contains(pop);
  });

  // drag + resize must still work in fullscreen
  const box0 = await popover.boundingBox();
  const hb = await popover.locator('div').first().boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + 14);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 - 120, hb.y + 14 - 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const box1 = await popover.boundingBox();
  results.draggableInFullscreen = !!(box0 && box1) && (Math.abs(box1.x - box0.x) > 40 || Math.abs(box1.y - box0.y) > 40);

  const grip = await popover.locator('[aria-label="Resize chat"]').boundingBox();
  await page.mouse.move(grip.x + 10, grip.y + 10);
  await page.mouse.down();
  await page.mouse.move(grip.x + 10 + 80, grip.y + 10 + 80, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const box2 = await popover.boundingBox();
  results.resizableInFullscreen = !!(box1 && box2) && (Math.abs(box2.width - box1.width) > 20 || Math.abs(box2.height - box1.height) > 20);

  await page.screenshot({ path: '/tmp/anet-issue-100/popover-fullscreen.png' });

  await popover.locator('button[aria-label="Close chat"]').click();
  await page.waitForTimeout(250);
  results.closesInFullscreen = (await popover.count()) === 0;

  await ctx.close();
  const ok = results.opensInFullscreen && results.insideFullscreenLayer &&
    results.draggableInFullscreen && results.resizableInFullscreen && results.closesInFullscreen;
  console.log(`${ok ? '✅' : '❌'} [fullscreen] 1440x900:`, JSON.stringify(results));
  return ok;
}

const all = [];
all.push(await run(1, { width: 1440, height: 900 }, 'desktop-1node'));
all.push(await run(5, { width: 1440, height: 900 }, 'desktop-5node'));
all.push(await run(50, { width: 1440, height: 900 }, 'desktop-50node'));
all.push(await run(5, { width: 390, height: 844 }, 'mobile-5node'));
all.push(await runFullscreen());

await browser.close();
const pass = all.every(Boolean);
console.log(pass ? '\n✅ ALL PASS' : '\n❌ FAIL');
process.exit(pass ? 0 : 1);
