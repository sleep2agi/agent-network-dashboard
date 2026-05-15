/* Round 25 verification: pressing `?` opens the help overlay, and the
 * new "Topology canvas" section is present with the documented keys. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
await ctx.route('**/api/hub/status*', (route) => route.fulfill({ json: { sessions: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);

await page.keyboard.press('?');
await page.waitForTimeout(200);

// The overlay contains group headings; find the Topology canvas group + its rows.
const data = await page.evaluate(() => {
  // The group heading is a <div>; its parent wraps heading + the <ul> of items.
  const heading = [...document.querySelectorAll('[role="dialog"] div')].find(el => el.textContent === 'Topology canvas');
  if (!heading) return null;
  return {
    headingPresent: true,
    sectionText: (heading.parentElement?.textContent || '').replace(/\s+/g, ' ').trim(),
  };
});

await browser.close();
const results = {
  overlayOpened: !!data,
  topologySectionPresent: !!data?.headingPresent,
  hasZoomKeys: !!data && /Zoom in/.test(data.sectionText) && /Zoom out/.test(data.sectionText) && /Reset zoom/.test(data.sectionText),
  hasMouseGestures: !!data && /wheel/.test(data.sectionText) && /Pan the canvas/.test(data.sectionText),
  hasClickHint: !!data && /chat popover/.test(data.sectionText) && /dbl-click/.test(data.sectionText),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} help overlay topology section:`, JSON.stringify(results));
if (!ok && data) console.log('section text:', data.sectionText.slice(0, 300));
process.exit(ok ? 0 : 1);
