/* Round 59 verification: HelpOverlay topology section documents the new
 * R52 (hub click → fit) / R55 (legend hover) / R56 (recent-signal hover)
 * interactions. R41 dbl-click clarification is also expected.
 *
 *   Press "?" on the overview page → assert each of the three new entries
 *   shows up under the "Topology canvas" group heading.
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
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  await route.fulfill({ response: r, json: b });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);

// Open help overlay via `?` (Shift + /).
await page.keyboard.press('?');
await page.waitForSelector('[role="dialog"][aria-label="Keyboard shortcuts"]', { timeout: 5000 });

const topology = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"][aria-label="Keyboard shortcuts"]');
  if (!dialog) return null;
  // Walk the group divs — each starts with the group title text. Pick the
  // one that says "Topology canvas" and capture its `<li>` items.
  const groups = [...dialog.querySelectorAll('div')];
  let active = null;
  for (const g of groups) {
    if (g.textContent && /^Topology canvas$/i.test(g.textContent.trim())) {
      active = g.parentElement;
      break;
    }
  }
  if (!active) return null;
  return [...active.querySelectorAll('li')].map(li => (li.textContent || '').trim());
});

await browser.close();
if (!topology) { console.log('❌ topology group not found in help overlay'); process.exit(1); }

const has = (s) => topology.some(t => t.includes(s));
const results = {
  hasHubClickEntry:     has('Fit topology to canvas (R52)'),
  hasLegendHoverEntry:  has('Highlight nodes of a status (R55)'),
  hasSignalHoverEntry:  has('Highlight one flow edge (R56)'),
  hasDblClickClarified: has('(empty canvas only)'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} help overlay R59:`, JSON.stringify(results),
  `\n  topology items=`, topology);
process.exit(ok ? 0 : 1);
