/* Round 78 verification: HelpOverlay surfaces the R73 (click pill body
 * to clear) + R77 (hover N active links to brighten all flows) gestures.
 * Both shipped as real user gestures but weren't in the discoverability
 * surface.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);

await page.keyboard.press('?');
await page.waitForSelector('[role="dialog"][aria-label="Keyboard shortcuts"]', { timeout: 5000 });

const items = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"][aria-label="Keyboard shortcuts"]');
  const groups = [...(dialog?.querySelectorAll('div') || [])];
  let active = null;
  for (const g of groups) {
    if (g.textContent && /^Topology canvas$/i.test(g.textContent.trim())) {
      active = g.parentElement;
      break;
    }
  }
  return active ? [...active.querySelectorAll('li')].map(li => (li.textContent || '').trim()) : [];
});

await browser.close();

const has = (s) => items.some(t => t.includes(s));
const results = {
  r78_pillBodyClick:   has('Clear filter — click anywhere on the pill body (R73)'),
  r78_chipHover:       has('Brighten all active flows — hover'),
  // R74 and R70 priors should still appear (no regression)
  r74_cmdkLayout:      has('Toggle layout / Fit canvas via palette (R74)'),
  r70_cmdkPin:         has('(R69)'),
  // R65 priors
  r63_groupPin:        has('Pin a team focus (R63)'),
  r64_clearOne:        has('Clear one filter (R64)'),
  // R59 priors
  r52_clickHub:        has('Fit topology to canvas (R52)'),
  r55_legendHover:     has('Highlight nodes of a status (R55)'),
  r56_signalHover:     has('Highlight one flow edge (R56)'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} help overlay R78:`, JSON.stringify(results),
  `\n  items=`, items);
process.exit(ok ? 0 : 1);
