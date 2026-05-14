/* Issue #96 verification: node visual identity — vendor avatar + runtime
 * badge. Mocks /api/hub/status with model/runtime fields and checks the
 * TopoGraph node rendering picks the right avatar + badge + tooltip. */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
mkdirSync('/tmp/anet-issue-96', { recursive: true });
const browser = await chromium.launch({ headless: true });

// alias → { model, runtime } — one node per vendor + runtime + a null-model node
const FLEET = [
  { alias: 'intern-1',  model: 'intern-s1-pro',   runtime: 'claude-code-cli' },
  { alias: 'minimax-1', model: 'MiniMax-Text-01', runtime: 'codex-sdk' },
  { alias: 'claude-1',  model: 'claude-opus-4',   runtime: 'claude-agent-sdk' },
  { alias: 'openai-1',  model: 'gpt-4o',          runtime: 'http-api' },
  { alias: 'legacy-1',  model: null,              runtime: null },
];

async function run(theme) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript((th) => {
    try {
      localStorage.setItem('anet-theme', th);
      localStorage.removeItem('anet-brand');
      localStorage.removeItem('anet-topo-view');
      localStorage.setItem('anet-topo-layout', 'grid');
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  }, theme);
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const sessions = FLEET.map(f => ({
      alias: f.alias, status: 'idle', network_id: nid, model: f.model, runtime: f.runtime,
      created_at: '2026-05-14T00:00:00Z', updated_at: '2026-05-14T00:00:00Z', last_seen_at: '2026-05-14T00:00:00Z',
    }));
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    return !!svg && svg.querySelectorAll('circle[r="26"]').length > 0;
  }, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(700);

  const results = {};
  const svg = 'svg[viewBox="0 0 1000 680"]';

  // intern model → <image> avatar (intern_avatar.png)
  results.internUsesImage = await page.locator(`${svg} image[href="/intern_avatar.png"]`).count() >= 1;

  // vendor monograms — minimax 'M' / anthropic 'A' / openai 'O' present as avatar text
  const texts = await page.$$eval(`${svg} text`, els => els.map(e => (e.textContent || '').trim()));
  results.minimaxMonogram = texts.includes('M');
  results.anthropicMonogram = texts.includes('A');
  results.openaiMonogram = texts.includes('O');
  // legacy null-model node → alias-hue initial 'L' (not a vendor monogram)
  results.legacyAliasInitial = texts.includes('L');

  // runtime badges: 4 nodes have a runtime → 4 badge groups. Badge = a small
  // circle stroked in a runtime colour. Count distinct runtime stroke colours.
  const badgeColors = await page.$$eval(`${svg} circle`, els =>
    els.map(e => e.getAttribute('stroke'))
       .filter(s => ['#a78bfa', '#38bdf8', '#34d399', '#fbbf24'].includes(s)));
  results.runtimeBadges = new Set(badgeColors).size === 4;

  // <title> tooltip carries the identity line for a vendor node
  results.tooltipHasIdentity = await page.evaluate(() => {
    const titles = [...document.querySelectorAll('svg[viewBox="0 0 1000 680"] g > title')]
      .map(t => t.textContent || '');
    return titles.some(t => /Anthropic · claude-opus-4 · Claude Agent SDK/.test(t));
  });

  await page.screenshot({ path: `/tmp/anet-issue-96/vendor-${theme}.png` });
  await ctx.close();

  const ok = results.internUsesImage && results.minimaxMonogram && results.anthropicMonogram &&
    results.openaiMonogram && results.legacyAliasInitial && results.runtimeBadges &&
    results.tooltipHasIdentity;
  console.log(`${ok ? '✅' : '❌'} [${theme}]:`, JSON.stringify(results));
  return ok;
}

const all = [];
all.push(await run('cyber'));
all.push(await run('light'));
await browser.close();
const pass = all.every(Boolean);
console.log(pass ? '\n✅ ALL PASS' : '\n❌ FAIL');
process.exit(pass ? 0 : 1);
