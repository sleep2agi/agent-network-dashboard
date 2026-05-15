/* Round 22 verification: keyboard zoom shortcuts (+/=, -, 0) + matching
 * title hints on the existing buttons. The handler must NOT fire while
 * an input/textarea has focus. */
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

const readZoomPct = () => page.$eval(
  'button[title^="Zoom in"]',
  btn => +btn.parentElement.querySelector('span[title*="zoom level"]').textContent.replace('%', ''),
);

const start = await readZoomPct();
await page.keyboard.press('=');
await page.waitForTimeout(50);
const afterPlus = await readZoomPct();

await page.keyboard.press('-');
await page.waitForTimeout(50);
const afterMinus = await readZoomPct();

// Zoom in twice via + then reset via 0
await page.keyboard.press('=');
await page.keyboard.press('=');
await page.waitForTimeout(50);
const beforeReset = await readZoomPct();
await page.keyboard.press('0');
await page.waitForTimeout(50);
const afterReset = await readZoomPct();

// Titles present
const titles = await page.evaluate(() => ({
  out: document.querySelector('button[aria-label="Zoom out"]').getAttribute('title'),
  in: document.querySelector('button[aria-label="Zoom in"]').getAttribute('title'),
  reset: document.querySelector('button[aria-label="Reset view"]').getAttribute('title'),
}));

// Input-focus suppression: open Cmd+K, type "-", expect topology NOT to zoom
await page.keyboard.press('Meta+k');
await page.waitForTimeout(200);
const palette = await page.locator('input[placeholder*="Search"], input[type="search"], [role="dialog"] input').first();
await palette.focus().catch(() => {});
const zoomBeforeTyping = await readZoomPct();
await page.keyboard.press('-');
await page.waitForTimeout(80);
const zoomAfterTyping = await readZoomPct();
await page.keyboard.press('Escape');

await browser.close();
const results = {
  startsAt100:     start === 100,
  plusZoomsIn:     afterPlus === 120,
  minusReverts:    afterMinus === 100,
  zeroResets:      beforeReset > 100 && afterReset === 100,
  titleOut:        /Zoom out.*[(−\-]/.test(titles.out || ''),
  titleIn:         /Zoom in.*\(\+/.test(titles.in || ''),
  titleReset:      /\b0\b/.test(titles.reset || ''),
  noZoomWhileTyping: zoomAfterTyping === zoomBeforeTyping,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} zoom keys:`, JSON.stringify(results), `titles=`, titles);
process.exit(ok ? 0 : 1);
