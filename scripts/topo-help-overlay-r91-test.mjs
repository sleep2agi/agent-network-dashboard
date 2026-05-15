/* Round 91 verification: HelpOverlay catches up on R88 vendor click-
 * to-pin and R90 granular Cmd+K vendor-clear. Continues the
 * R59/R62/R65/R70/R78/R81/R87 docs-catch-up cadence.
 *
 * Seven generations of help-overlay assertions stacked here — any
 * future regression that drops an entry will be caught by one of
 * R91 → R87 → R81 → R78 → R74 → R70 → R65 → R59.
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
  r91_vendorPin:        has('Pin a vendor filter — click A/O/书/? in the chip row (R88)'),
  r91_cmdkVendorClear:  has('Clear vendor pin only via palette → "Clear topology vendor filter" (R90)'),
  // R87 priors (hover preview pair)
  r87_segHover:         has('Preview a status filter — hover a pressure-bar segment (R83)'),
  r87_groupLabelHover:  has('Preview a team focus — hover a group label (R86)'),
  // R81 priors (chip-row hover pair)
  r81_workingChip:      has('Highlight working nodes — chip-row sibling of legend (R79)'),
  r81_vendorChip:       has('Highlight one vendor — hover A/O/书/? in the chip row (R80)'),
  // R78 / R74 / R70 / R65 / R59 priors — seven generations
  r78_pillBodyClick:    has('Clear filter — click anywhere on the pill body (R73)'),
  r74_cmdkLayout:       has('Toggle layout / Fit canvas via palette (R74)'),
  r70_cmdkPin:          has('(R69)'),
  r65_groupClick:       has('Pin a team focus (R63)'),
  r62_pinChip:          has('Pin a status filter (R60/R61)'),
  r59_clickHub:         has('Fit topology to canvas (R52)'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} help overlay R91:`, JSON.stringify(results),
  `\n  items=`, items);
process.exit(ok ? 0 : 1);
