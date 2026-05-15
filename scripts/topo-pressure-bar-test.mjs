/* Round 31 verification: fleet-pressure chip with proportional segments.
 * 4 working + 6 idle + 2 offline = 12 total → 33% / 50% / 17%. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
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
  const make = (alias, status) => ({
    alias, status, network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  const sessions = [
    ...Array.from({ length: 4 }, (_, i) => make(`w${i}`, 'working')),
    ...Array.from({ length: 6 }, (_, i) => make(`i${i}`, 'idle')),
    ...Array.from({ length: 2 }, (_, i) => make(`o${i}`, 'offline')),
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-fleet-pressure]', { timeout: 30000 });
await page.waitForTimeout(400);

const chip = '[data-fleet-pressure]';
const titleText = await page.locator(chip).getAttribute('title');
// The chip layout: <chip> > <label-span> + <bar-span> ; bar-span has the 3 segment spans.
const segments = await page.evaluate(() => {
  const chip = document.querySelector('[data-fleet-pressure]');
  if (!chip) return [];
  // The bar container is the inline-flex w-16 span (second child).
  const bar = [...chip.children].find(c => c.classList?.contains('w-16'));
  if (!bar) return [];
  return [...bar.children].map(el => ({ width: el.style.width, background: el.style.background }));
});
const segmentWidths = segments.map(s => s.width);
const segmentColors = segments.map(s => s.background);

// 4/12 = 33.33%, 6/12 = 50.00%, 2/12 = 16.67%
const close = (a, b) => Math.abs(parseFloat(a) - b) < 0.5;

await browser.close();
const results = {
  titleHasCounts: titleText === '4 working · 6 idle · 2 offline',
  threeSegments: segmentWidths.length === 3,
  workingProportion: close(segmentWidths[0], 100 * 4 / 12),
  idleProportion: close(segmentWidths[1], 100 * 6 / 12),
  offlineProportion: close(segmentWidths[2], 100 * 2 / 12),
  workingColor: /22c55e|rgb\(34, 197, 94\)/.test(segmentColors[0] || ''),
  idleColor: /2dd4bf|rgb\(45, 212, 191\)/.test(segmentColors[1] || ''),
  offlineColor: /6b7280|rgb\(107, 114, 128\)/.test(segmentColors[2] || ''),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} pressure bar:`, JSON.stringify(results), `widths=${segmentWidths.join(',')} colors=${segmentColors.join(' | ')}`);
process.exit(ok ? 0 : 1);
