/* Round 23 verification: wheel-zoom is guarded inline (requires
 * ctrl/meta) but unconditional in fullscreen. Plain wheel over the
 * canvas must let page scroll through. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = ['a', 'b'].map(a => ({
    alias: a, status: 'idle', network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  }));
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('svg[viewBox="0 0 1000 680"]', { timeout: 30000 });
await page.waitForTimeout(400);

const readZoom = () => page.evaluate(() => {
  const span = document.querySelector('button[aria-label="Zoom in"]').parentElement.querySelector('span[title*="zoom level"]');
  return +span.textContent.replace('%', '');
});

// Move cursor over the SVG centre
const box = await page.$eval('svg[viewBox="0 0 1000 680"]', el => el.getBoundingClientRect());
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
const start = await readZoom();

// PLAIN wheel — must NOT zoom (guard active inline)
await page.mouse.wheel(0, -100);
await page.waitForTimeout(80);
const afterPlainWheel = await readZoom();

// PLAIN wheel must let page scroll
const scrollBefore = await page.evaluate(() => window.scrollY);
await page.mouse.wheel(0, 200);
await page.waitForTimeout(80);
const scrollAfter = await page.evaluate(() => window.scrollY);
// scroll back so the next test has the SVG in view
await page.evaluate(() => window.scrollTo(0, 0));
await page.mouse.move(cx, cy);
await page.waitForTimeout(100);

// CTRL+wheel — must zoom inline
const beforeCtrl = await readZoom();
await page.keyboard.down('Control');
await page.mouse.wheel(0, -100);
await page.keyboard.up('Control');
await page.waitForTimeout(80);
const afterCtrl = await readZoom();

await browser.close();
const results = {
  plainWheelDoesNotZoom: afterPlainWheel === start,
  plainWheelPageScrolls: scrollAfter > scrollBefore,
  ctrlWheelZooms: afterCtrl > beforeCtrl,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} wheel zoom guard:`, JSON.stringify(results),
  `start=${start} plainWheel=${afterPlainWheel} scrollBefore=${scrollBefore} scrollAfter=${scrollAfter} beforeCtrl=${beforeCtrl} afterCtrl=${afterCtrl}`);
process.exit(ok ? 0 : 1);
