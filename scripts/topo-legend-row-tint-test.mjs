/* Round 105 verification: legend rows in the SVG panel pick up a
 * row-background tint on hover and pin, mirroring R104's treatment
 * on the recent-signal panel. The tint uses the ROW'S OWN swatch
 * colour (working=green, idle=teal, offline=slate) so the user's
 * eye associates the highlight with its swatch instead of a generic
 * accent.
 *
 * Verifies idle / hover / pinned states via the new data-legend-
 * row-tinted attribute + actual fill/opacity. Pin is stronger than
 * hover; idle is transparent.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    sessionStorage.removeItem('anet-topo-pinned-status');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('wkr1', 'working'),
    mk('idl1', 'idle'),
    mk('off1', 'offline'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForTimeout(400);

const readRow = (key) => page.evaluate((k) => {
  const g = document.querySelector(`[data-legend-status="${k}"]`);
  if (!g) return null;
  const rect = g.querySelector('rect');
  return {
    tinted:  rect?.getAttribute('data-legend-row-tinted') || '',
    fill:    rect?.getAttribute('fill') || '',
    opacity: rect?.getAttribute('opacity') || '',
  };
}, key);

const before = await Promise.all(['working', 'idle', 'offline'].map(readRow));

// Hover working.
await page.locator('[data-legend-status="working"]').hover();
await page.waitForTimeout(250);
const onHoverWorking = await Promise.all(['working', 'idle', 'offline'].map(readRow));

// Move away — clears hover.
await page.mouse.move(10, 10);
await page.waitForTimeout(250);

// Pin idle.
await page.locator('[data-legend-status="idle"]').click();
await page.waitForTimeout(250);
const onPinIdle = await Promise.all(['working', 'idle', 'offline'].map(readRow));

await browser.close();

const opacity = (s) => parseFloat(s) || 0;
const results = {
  before_allTransparent: before.every(r => r?.tinted === 'none' && r?.fill === 'transparent'),
  hoverWorking_workingTinted: onHoverWorking[0]?.tinted === 'hover' && onHoverWorking[0]?.fill !== 'transparent',
  hoverWorking_othersUnchanged: onHoverWorking.slice(1).every(r => r?.tinted === 'none'),
  hoverWorking_opacityLow:    opacity(onHoverWorking[0]?.opacity || '') > 0 && opacity(onHoverWorking[0]?.opacity || '') < 0.2,
  pinIdle_idlePinned:         onPinIdle[1]?.tinted === 'pinned' && onPinIdle[1]?.fill !== 'transparent',
  pinIdle_pinStrongerThanHover: opacity(onPinIdle[1]?.opacity || '') > opacity(onHoverWorking[0]?.opacity || ''),
  pinIdle_otherRowsClean:     onPinIdle.filter((_, i) => i !== 1).every(r => r?.tinted === 'none'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend-row tint:`, JSON.stringify(results),
  `\n  before=`,         before,
  `\n  onHoverWorking=`, onHoverWorking,
  `\n  onPinIdle=`,      onPinIdle);
process.exit(ok ? 0 : 1);
