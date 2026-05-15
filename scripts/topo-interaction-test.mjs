/* Round 103 verification: exercise TopoGraph zoom / pan / reset / fullscreen
 * and confirm the transform group actually moves + localStorage persists. */
import { chromium } from 'playwright';

const TOKEN = process.env.LOOP_REVIEW_TOKEN;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  return !!svg && svg.querySelectorAll('circle[r="26"]').length > 0;
}, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(800);
await page.evaluate(() => {
  const h = [...document.querySelectorAll('h2')].find(x => /Command mesh/i.test(x.textContent || ''));
  h?.scrollIntoView({ behavior: 'instant', block: 'center' });
});
await page.waitForTimeout(500);

const transformOf = () => page.evaluate(() => {
  const g = document.querySelector('svg[viewBox="0 0 1000 680"] > g[transform^="translate"]');
  return g?.getAttribute('transform') || null;
});

const t0 = await transformOf();
console.log('initial transform:', t0);

// --- zoom in via the + button ---
await page.locator('button[aria-label="Zoom in"]').click();
await page.locator('button[aria-label="Zoom in"]').click();
await page.waitForTimeout(200);
const tZoom = await transformOf();
console.log('after 2x zoom-in:', tZoom);
const zoomLabel = await page.locator('button[aria-label="Reset view"]').textContent();
console.log('zoom label:', zoomLabel);

// --- screenshot zoomed ---
await page.locator('svg[viewBox="0 0 1000 680"]').screenshot({ path: '/tmp/anet-issue-50/topo-zoom-in.png' });

// --- pan drag ---
const svgBox = await page.locator('svg[viewBox="0 0 1000 680"]').boundingBox();
await page.mouse.move(svgBox.x + svgBox.width / 2, svgBox.y + svgBox.height / 2);
await page.mouse.down();
await page.mouse.move(svgBox.x + svgBox.width / 2 + 120, svgBox.y + svgBox.height / 2 + 80, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(200);
const tPan = await transformOf();
console.log('after pan drag:', tPan);
await page.locator('svg[viewBox="0 0 1000 680"]').screenshot({ path: '/tmp/anet-issue-50/topo-pan.png' });

// --- wheel zoom ---
await page.mouse.move(svgBox.x + svgBox.width * 0.3, svgBox.y + svgBox.height * 0.4);
await page.mouse.wheel(0, -300);
await page.waitForTimeout(200);
const tWheel = await transformOf();
console.log('after wheel zoom:', tWheel);

// --- reset ---
await page.locator('button[aria-label="Reset view"]').click();
await page.waitForTimeout(200);
const tReset = await transformOf();
console.log('after reset:', tReset);

// --- localStorage persist check ---
await page.locator('button[aria-label="Zoom in"]').click();
await page.waitForTimeout(200);
const stored = await page.evaluate(() => localStorage.getItem('anet-topo-view'));
console.log('localStorage anet-topo-view:', stored);

// --- fullscreen button present ---
const fsBtn = await page.locator('button[aria-label="Enter fullscreen"]').count();
console.log('fullscreen button present:', fsBtn === 1);

await browser.close();
console.log('done');
