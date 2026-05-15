/* Round 70 verification: HelpOverlay topology section surfaces the R69
 * Cmd+K palette pin actions. The 1 new entry sits alongside R65's R63
 * + R64 entries; this test re-verifies the full chain so a future edit
 * accidentally dropping any rung gets caught here.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
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
  if (!dialog) return [];
  const groups = [...dialog.querySelectorAll('div')];
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
if (items.length === 0) { console.log('❌ topology section not found'); process.exit(1); }

const has = (s) => items.some(t => t.includes(s));
const results = {
  r70_cmdkPin:       has('Pin / clear filters via palette') && has('(R69)'),
  // R65 priors
  r63_groupPin:      has('Pin a team focus (R63)'),
  r64_clearOne:      has('Clear one filter (R64)'),
  // R62 priors
  r60_pinChip:       has('Pin a status filter (R60/R61)'),
  r62_esc:           has('Clear pinned filter (R62)'),
  // R59 priors
  r52_clickHub:      has('Fit topology to canvas (R52)'),
  r55_legendHover:   has('Highlight nodes of a status (R55)'),
  r56_signalHover:   has('Highlight one flow edge (R56)'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} help overlay R70:`, JSON.stringify(results),
  `\n  items=`, items);
process.exit(ok ? 0 : 1);
