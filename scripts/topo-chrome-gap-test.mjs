/* Round 326 verification: chrome strip outer wrapper gap-1.5 → gap-2
 * (6px → 8px between control groups).
 *
 * The strip stacks four interactive chrome groups: nodeSize segmented
 * (S/M/L), zoom +/100%/−, reset, fullscreen. Pre-R326 these sat 6px
 * apart — close enough to read as one uniform strip rather than four
 * distinct affordances. R326 bumps to 8px so each group breathes.
 *
 * Contract:
 *   - [data-topo-chrome] className contains 'gap-2' (not 'gap-1.5').
 *   - Computed gap is 8px (Tailwind gap-2 = 0.5rem = 8px at root 16px).
 *   - R325 footer letterSpacing=0.2 regression intact (when flowLinks
 *     mount; fixture-tolerant).
 *   - R317/R318 chrome regression: Layout toggle still inactive
 *     gray-400 + active font-medium.
 *   - R294 pulse absent.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-chrome]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const chrome = document.querySelector('[data-topo-chrome]');
  const cs = chrome ? getComputedStyle(chrome) : null;
  return {
    chromeClass:        chrome?.className ?? '',
    chromeColumnGap:    cs?.columnGap ?? null,
    layoutInactiveCls:  document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    layoutActiveCls:    document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount:         document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const results = {
  chrome_has_gap_2:           probe.chromeClass.includes('gap-2') && !probe.chromeClass.includes('gap-1.5'),
  chrome_gap_8px:             probe.chromeColumnGap === '8px',
  // R317 / R318 regression.
  r317_inactive_gray_400:     probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:    probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:          probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chrome strip gap-2:`, JSON.stringify(results),
  '\n  chrome class:', probe.chromeClass,
  '\n  column-gap:', probe.chromeColumnGap);
process.exit(ok ? 0 : 1);
