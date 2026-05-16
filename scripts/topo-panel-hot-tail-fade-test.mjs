/* Round 190 verification: R129 hot-tail tspan in recent-signal
 * panel header gets anet-fade-in for smooth entrance.
 *
 * Pre-R190 the tspan mounted/unmounted on hotFlowCount > 0 —
 * snap. R190 keeps the conditional render (so the tspan
 * doesn't consume layout when no hot flows) but adds the R3
 * .anet-fade-in CSS animation that plays once on mount.
 *
 * Test scenarios:
 *   A. 0 hot flows (just a few cold ones):
 *      [data-recent-panel-hot-count] NOT present
 *   B. 1 hot flow (count=12):
 *      tspan present with text '· 1 hot', className contains
 *      'anet-fade-in', data-recent-panel-hot-count='1'
 *   C. 2 hot flows (count=15 + count=20):
 *      data-recent-panel-hot-count='2', text '· 2 hot'
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

async function run(scenario) {
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  await ctx.unroute('**/api/hub/status*').catch(() => {});
  await ctx.unroute('**/api/hub/messages*').catch(() => {});
  await ctx.unroute('**/api/hub/tasks*').catch(() => {});
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const mk = (alias) => ({
      alias, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    await route.fulfill({ response: r, json: { ...b, sessions: [
      mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
    ] } });
  });
  const now = Date.now();
  const msgs = scenario(now);
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
  await page.waitForSelector('[data-recent-panel-count]', { timeout: 10000 });
  await page.waitForTimeout(400);

  const out = await page.evaluate(() => {
    const tail = document.querySelector('[data-recent-panel-hot-count]');
    return {
      tailPresent:    !!tail,
      tailText:       tail?.textContent || null,
      tailCount:      tail?.getAttribute('data-recent-panel-hot-count'),
      tailClassName:  tail?.getAttribute('class') || '',
      // R223 added: visibility attribute for always-mount-with-opacity-
      // gate. "no tail" is either tailPresent=false (legacy conditional
      // mount, no longer current) OR tailVisible='false' (R223 always-
      // mount with opacity 0).
      tailVisible:    tail?.getAttribute('data-recent-panel-hot-visible'),
    };
  });
  await page.close();
  return out;
}

// Scenario A: 0 hot — 1 cold flow
const a = await run((now) => {
  const m = [];
  for (let i = 0; i < 4; i++) {
    m.push({ id: `cold${i}`, from_alias: 'alpha', to_alias: 'beta', content: 'hi',
      network_id: 'default', created_at: new Date(now - (1000 + i * 50)).toISOString() });
  }
  return m;
});

// Scenario B: 1 hot flow alpha→beta count=12
const b = await run((now) => {
  const m = [];
  for (let i = 0; i < 12; i++) {
    m.push({ id: `hot${i}`, from_alias: 'alpha', to_alias: 'beta', content: 'hi',
      network_id: 'default', created_at: new Date(now - (1000 + i * 50)).toISOString() });
  }
  return m;
});

// Scenario C: 2 hot flows
const c = await run((now) => {
  const m = [];
  for (let i = 0; i < 15; i++) {
    m.push({ id: `h1-${i}`, from_alias: 'alpha', to_alias: 'beta', content: 'hi',
      network_id: 'default', created_at: new Date(now - (5000 + i * 50)).toISOString() });
  }
  for (let i = 0; i < 20; i++) {
    m.push({ id: `h2-${i}`, from_alias: 'gamma', to_alias: 'delta', content: 'hi',
      network_id: 'default', created_at: new Date(now - (15000 + i * 50)).toISOString() });
  }
  return m;
});

await browser.close();

const results = {
  // R223 update: hot-tail is always-mounted now with opacity-gate;
  // "no tail" means either not in DOM (legacy) OR present-but-hidden
  // (always-mount visible='false'). Accept both forms.
  a_no_tail:               a.tailPresent === false || a.tailVisible === 'false',
  b_tail_present:          b.tailPresent === true,
  b_tail_text:             /·\s*1\s*hot/.test(b.tailText || ''),
  b_tail_count_1:          b.tailCount === '1',
  b_has_fade_class:        b.tailClassName.includes('anet-fade-in'),
  c_tail_present:          c.tailPresent === true,
  c_tail_text:             /·\s*2\s*hot/.test(c.tailText || ''),
  c_tail_count_2:          c.tailCount === '2',
  c_has_fade_class:        c.tailClassName.includes('anet-fade-in'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} panel hot-tail fade:`, JSON.stringify(results),
  `\n  A (0 hot):`, a,
  `\n  B (1 hot):`, b,
  `\n  C (2 hot):`, c);
process.exit(ok ? 0 : 1);
