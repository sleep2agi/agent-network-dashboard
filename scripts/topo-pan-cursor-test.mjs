/* Round 21 verification: SVG cursor flips from grab → grabbing during
 * a pan drag and back to grab on release. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
// Need a tall enough viewport to keep the SVG ABOVE the fold so real
// pointer events land — at 1280×900 the canvas starts at ~y=815 (the
// /admin hero + StatsBar above push it below the viewport bottom).
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

const cursorAt = () => page.$eval('svg[viewBox="0 0 1000 680"]', el => el.style.cursor);
const rest = await cursorAt();

// pick a pan-safe target far from any node — top-left empty canvas region
const box = await page.$eval('svg[viewBox="0 0 1000 680"]', el => el.getBoundingClientRect());
const sx = box.x + box.width * 0.08;
const sy = box.y + box.height * 0.40;

await page.mouse.move(sx, sy);
await page.mouse.down();
await page.mouse.move(sx + 40, sy + 30);
await page.waitForTimeout(50);
const during = await cursorAt();
await page.mouse.up();
await page.waitForTimeout(50);
const after = await cursorAt();

await browser.close();
const results = {
  restIsGrab: rest === 'grab',
  duringIsGrabbing: during === 'grabbing',
  afterIsGrab: after === 'grab',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} pan cursor:`, JSON.stringify(results), `rest=${rest} during=${during} after=${after}`);
process.exit(ok ? 0 : 1);
