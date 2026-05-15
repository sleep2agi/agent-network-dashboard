/* Round 121 verification: clicking an edge midpoint count badge
 * (R100) pins the matching flow, mirroring the R116 recent-signal
 * row click-pin from the canvas side. Closes the gap where the
 * canvas had no pin-from-here affordance.
 *
 * Drive: 1 flow with count >= 3 (badge renders). Click badge →
 * data-edge-count-badge-pinned="true", aria-pressed="true", the
 * matching pill (R119) appears. Click again → release.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
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
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta'), mk('gamma')] } });
});

const now = Date.now();
const mkMsg = (id, from_alias, to_alias, ageMs) => ({
  id, from_alias, to_alias, content: 'hi', network_id: 'default',
  created_at: new Date(now - ageMs).toISOString(),
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
  mkMsg('m1', 'alpha', 'beta', 30 * 1000),
  mkMsg('m2', 'alpha', 'beta', 40 * 1000),
  mkMsg('m3', 'alpha', 'beta', 50 * 1000),
  mkMsg('m4', 'alpha', 'beta', 60 * 1000),
] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-edge-count-badge]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = () => page.evaluate(() => {
  const badge = document.querySelector('[data-edge-count-badge="alpha->beta"]');
  return {
    badgePinned: badge?.getAttribute('data-edge-count-badge-pinned') || '',
    aria:        badge?.getAttribute('aria-pressed') || '',
    pillExists:  document.querySelector('[data-active-filter="edge"]') !== null,
    title:       badge?.querySelector('title')?.textContent || '',
  };
});

const before = await probe();

// Click the badge → pin.
await page.locator('[data-edge-count-badge="alpha->beta"]').click();
await page.mouse.move(10, 10);
await page.waitForTimeout(300);
const afterClick = await probe();

// Click again → release.
await page.locator('[data-edge-count-badge="alpha->beta"]').click();
await page.mouse.move(10, 10);
await page.waitForTimeout(300);
const afterRelease = await probe();

await browser.close();

const results = {
  before_notPinned:       before.badgePinned === 'false' && before.aria === 'false',
  before_noPill:          before.pillExists === false,
  before_titlePinHint:    /click to pin/.test(before.title),
  click_pinned:           afterClick.badgePinned === 'true' && afterClick.aria === 'true',
  click_pillAppears:      afterClick.pillExists === true,
  click_titleReleaseHint: /click to release pin/.test(afterClick.title),
  release_unpinned:       afterRelease.badgePinned === 'false' && afterRelease.aria === 'false',
  release_pillGone:       afterRelease.pillExists === false,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge-badge click-pin:`, JSON.stringify(results),
  `\n  before=`,       before,
  `\n  afterClick=`,   afterClick,
  `\n  afterRelease=`, afterRelease);
process.exit(ok ? 0 : 1);
