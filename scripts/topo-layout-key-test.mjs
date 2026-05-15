/* Round 32 verification: `l` (and `L`) keyboard shortcut toggles
 * ring ↔ grid; titles + Help overlay surface the hint; input-focus
 * suppression still blocks it. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'grid'); // start on grid
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = ['a', 'b', 'c'].map(a => ({
    alias: a, status: 'idle', network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  }));
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('button[aria-label="Topology layout"], button[title*="Ring layout"]', { timeout: 30000 });
await page.waitForTimeout(400);

const layoutPressed = () => page.evaluate(() => {
  const ring = document.querySelector('button[title^="Ring layout"]');
  const grid = document.querySelector('button[title^="Grid layout"]');
  return { ring: ring?.getAttribute('aria-pressed'), grid: grid?.getAttribute('aria-pressed') };
});

const initial = await layoutPressed();

// Press `l` → should toggle to ring
await page.keyboard.press('l');
await page.waitForTimeout(150);
const afterL = await layoutPressed();

// Press `L` (shift+l) → toggle back to grid
await page.keyboard.press('Shift+L');
await page.waitForTimeout(150);
const afterShiftL = await layoutPressed();

// Titles carry the hint
const titles = await page.evaluate(() => ({
  ring: document.querySelector('button[title^="Ring layout"]')?.getAttribute('title') || '',
  grid: document.querySelector('button[title^="Grid layout"]')?.getAttribute('title') || '',
}));

// Help overlay lists the shortcut
await page.keyboard.press('?');
await page.waitForTimeout(200);
const helpHasLayout = await page.evaluate(() => {
  const heading = [...document.querySelectorAll('[role="dialog"] div')].find(el => el.textContent === 'Topology canvas');
  if (!heading) return false;
  return /Toggle layout/i.test(heading.parentElement?.textContent || '');
});

// Input-focus suppression — Cmd+K input, press l, no toggle
await page.keyboard.press('Escape');
await page.keyboard.press('Meta+k');
await page.waitForTimeout(200);
const palette = page.locator('input[placeholder*="Search"], input[type="search"], [role="dialog"] input').first();
await palette.focus().catch(() => {});
const beforeFocusToggle = await layoutPressed();
await page.keyboard.press('l');
await page.waitForTimeout(150);
const afterFocusToggle = await layoutPressed();
await page.keyboard.press('Escape');

await browser.close();
const results = {
  startsGrid: initial.grid === 'true' && initial.ring === 'false',
  lTogglesToRing: afterL.ring === 'true' && afterL.grid === 'false',
  shiftLTogglesBack: afterShiftL.grid === 'true' && afterShiftL.ring === 'false',
  titlesPresent: /l to toggle/i.test(titles.ring) && /l to toggle/i.test(titles.grid),
  helpListsLayout: helpHasLayout,
  inputFocusSuppressed: beforeFocusToggle.grid === afterFocusToggle.grid && beforeFocusToggle.ring === afterFocusToggle.ring,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} layout key:`, JSON.stringify(results), `titles=`, titles);
process.exit(ok ? 0 : 1);
