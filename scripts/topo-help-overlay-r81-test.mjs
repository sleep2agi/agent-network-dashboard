/* Round 81 verification: HelpOverlay surfaces R79 (status chip hover) +
 * R80 (vendor chip letter hover). Both gestures landed without entries
 * in the discoverability surface. Continues the R59/R62/R65/R70/R78
 * docs-catch-up cadence.
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
  r81_workingChip:    has('Highlight working nodes — chip-row sibling of legend (R79)'),
  r81_vendorChip:     has('Highlight one vendor — hover A/O/书/? in the chip row (R80)'),
  // R78 priors
  r73_pillBodyClick:  has('Clear filter — click anywhere on the pill body (R73)'),
  r77_activeLinks:    has('Brighten all active flows — hover'),
  // R74 / R70 / R65 / R59 priors
  r74_cmdkLayout:     has('Toggle layout / Fit canvas via palette (R74)'),
  r70_cmdkPin:        has('(R69)'),
  r63_groupPin:       has('Pin a team focus (R63)'),
  r60_pinChip:        has('Pin a status filter (R60/R61)'),
  r52_clickHub:       has('Fit topology to canvas (R52)'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} help overlay R81:`, JSON.stringify(results),
  `\n  items=`, items);
process.exit(ok ? 0 : 1);
