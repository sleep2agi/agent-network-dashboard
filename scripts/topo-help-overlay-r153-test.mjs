/* Round 153 verification: HelpOverlay catches up on R151 — keyboard
 * chat-open on a focused node. First true new gesture since R141's
 * R139/R140 chip catch-up (R142 / R143 / R144 / R145 / R146 / R147 /
 * R148 / R149 / R150 were visual / motion / hover-tooltip refinements
 * with no new user gestures; R152 added an onKeyDown to the group
 * label but that's just the keyboard parallel of the existing R63
 * click-group entry, so it doesn't earn its own line).
 *
 * Stacks 15 docs generations now: R153 → R141 (×2) → R137 → R134 →
 * R123 → R118 → R109 → R91 → R87 → R81 → R78 → R74 → R70 → R65 → R59.
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
  // R153 NEW — keyboard chat-open
  r153_tabEnter:       has('Open chat on a focused node (also Space) — keyboard parallel of click-to-chat (R151)'),
  // R141 priors (2 entries)
  r141_workingPin:     has('Pin "working" status — click "N working" in the chip row (R139)'),
  r141_onlineNav:      has('Open the agent list — click "N online" in the chip row (R140)'),
  // R137 prior
  r137_clickChip:      has('See all flows — click the "N active links" chip in the chip row (R136)'),
  // R134 prior
  r134_clickFooter:    has('See all flows — click "+ N more flows" in the recent-signal panel (R133)'),
  // R123 prior
  r123_clickBadge:     has('Pin a flow filter from the canvas — click an edge midpoint count badge (R121)'),
  // R118 priors
  r118_rowClickPin:    has('Pin a flow filter — click a recent-signal row to lock the edge (R116)'),
  r118_cmdkClearEdge:  has('Clear edge pin only via palette → "Clear topology edge pin" (R117)'),
  // R109 prior
  r109_pinVendor:      has('Pin vendor: Anthropic/OpenAI/书生 via palette → "Pin topology filter…" (R108)'),
  // R91 prior
  r91_clickVendor:     has('Pin a vendor filter — click A/O/书/? in the chip row (R88)'),
  // R87 prior
  r87_segHover:        has('Preview a status filter — hover a pressure-bar segment (R83)'),
  // R81 prior
  r81_vendorChip:      has('Highlight one vendor — hover A/O/书/? in the chip row (R80)'),
  // R78 prior
  r78_pillBodyClick:   has('Clear filter — click anywhere on the pill body (R73)'),
  // R74 prior
  r74_cmdkLayout:      has('Toggle layout / Fit canvas via palette (R74)'),
  // R70 prior
  r70_cmdkPin:         has('(R69)'),
  // R65 prior
  r65_groupClick:      has('Pin a team focus (R63)'),
  // R59 prior
  r59_clickHub:        has('Fit topology to canvas (R52)'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} help overlay R153:`, JSON.stringify(results),
  `\n  items=`, items);
process.exit(ok ? 0 : 1);
