/* Round 118 verification: HelpOverlay catches up on R116 (recent-
 * signal row click pins the edge) + R117 (Cmd+K clear-edge command).
 * Continues the R59/R62/R65/R70/R78/R81/R87/R91/R109 cadence (~5-8
 * rounds between syncs).
 *
 * Nine generations of help-overlay assertions stacked here — any
 * future regression that drops an entry is caught by one of:
 *   R118 → R109 → R91 → R87 → R81 → R78 → R74 → R70 → R65 → R59
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
  r118_rowClickPin:    has('Pin a flow filter — click a recent-signal row to lock the edge (R116)'),
  r118_cmdkClearEdge:  has('Clear edge pin only via palette → "Clear topology edge pin" (R117)'),
  // R109 priors
  r109_pinVendor:      has('Pin vendor: Anthropic/OpenAI/书生 via palette → "Pin topology filter…" (R108)'),
  // R91 priors
  r91_clickVendor:     has('Pin a vendor filter — click A/O/书/? in the chip row (R88)'),
  r91_clearVendor:     has('Clear vendor pin only via palette → "Clear topology vendor filter" (R90)'),
  // R87 priors
  r87_segHover:        has('Preview a status filter — hover a pressure-bar segment (R83)'),
  // R81 priors
  r81_vendorChip:      has('Highlight one vendor — hover A/O/书/? in the chip row (R80)'),
  // R78 / R74 / R70 / R65 / R59 priors — 10 generations
  r78_pillBodyClick:   has('Clear filter — click anywhere on the pill body (R73)'),
  r74_cmdkLayout:      has('Toggle layout / Fit canvas via palette (R74)'),
  r70_cmdkPin:         has('(R69)'),
  r65_groupClick:      has('Pin a team focus (R63)'),
  r62_pinChip:         has('Pin a status filter (R60/R61)'),
  r59_clickHub:        has('Fit topology to canvas (R52)'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} help overlay R118:`, JSON.stringify(results),
  `\n  items=`, items);
process.exit(ok ? 0 : 1);
