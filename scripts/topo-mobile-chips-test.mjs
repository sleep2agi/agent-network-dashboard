/* Round 47 verification: mobile chip collapse.
 *  - At narrow viewport (375px), pressure / vendor-dist / active-links /
 *    freshness chips are display:none; only essential chips render.
 *  - At sm+ (≥640px), the full chip row is visible.
 *  - Essential chips (Ring/Grid toggle + working + online) render at both. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function probe(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
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
    const sessions = [
      { alias: 'wkr', status: 'working', network_id: nid, project_dir: null,
        model: 'claude-opus-4', runtime: 'cli-claude-code',
        created_at: fresh, updated_at: fresh, last_seen_at: fresh },
      { alias: 'idl', status: 'idle', network_id: nid, project_dir: null,
        model: 'gpt-5', runtime: 'codex-cli',
        created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    ];
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
    { from_alias: 'wkr', to_alias: 'idl', content: 'm', created_at: new Date().toISOString() },
  ] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  // The Overview page auto-hides the topology when window.innerWidth < 1024
  // (the lg breakpoint). On narrow viewports the user clicks "Show
  // Topology" to surface it; mimic that here so the chip-row tests reach
  // the actual code path. Wait for SWR to deliver sessions first so the
  // button renders before we look for it.
  await page.waitForTimeout(1500);
  const showBtn = page.locator('button', { hasText: /Show Topology/i });
  if (await showBtn.count() > 0) await showBtn.first().click();
  await page.waitForSelector('svg[viewBox="0 0 1000 680"]', { timeout: 30000 });
  await page.waitForTimeout(600);
  const visible = (sel) => page.evaluate(s => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }, sel);
  const result = {
    workingChipVisible: await page.evaluate(() => {
      // "{N} working" chip — find the green-tinted one
      const spans = [...document.querySelectorAll('span')];
      const chip = spans.find(s => /^\d+ working$/.test((s.textContent || '').trim()));
      if (!chip) return false;
      const r = chip.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }),
    onlineChipVisible: await page.evaluate(() => {
      const spans = [...document.querySelectorAll('span')];
      const chip = spans.find(s => /^\d+ online$/.test((s.textContent || '').trim()));
      if (!chip) return false;
      const r = chip.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }),
    pressureVisible: await visible('[data-fleet-pressure]'),
    activeLinksVisible: await page.evaluate(() => {
      const spans = [...document.querySelectorAll('span')];
      const chip = spans.find(s => /active link/.test(s.textContent || ''));
      if (!chip) return false;
      const r = chip.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }),
    freshnessVisible: await visible('[data-freshness-chip]'),
  };
  await ctx.close();
  return result;
}

const mobile = await probe(375);
const desktop = await probe(900);
await browser.close();

const results = {
  mobileEssentialsVisible: mobile.workingChipVisible && mobile.onlineChipVisible,
  mobilePressureHidden: mobile.pressureVisible === false,
  mobileActiveLinksHidden: mobile.activeLinksVisible === false,
  mobileFreshnessHidden: mobile.freshnessVisible === false,
  desktopAllVisible: desktop.workingChipVisible && desktop.onlineChipVisible && desktop.pressureVisible && desktop.activeLinksVisible && desktop.freshnessVisible,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} mobile chips:`, JSON.stringify(results),
  `\n  mobile=`, mobile, `\n  desktop=`, desktop);
process.exit(ok ? 0 : 1);
