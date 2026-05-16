/* Round 319 verification: prefix-group label drops the redundant
 * tier pip when its count equals box.count (single-tier groups).
 *
 * Vincent telegram 5304 (2026-05-16) flagged real-data screenshot
 * with `ai-insight · 6 6i`, `blueleap · 3 3i`, `P站 · 4 4i` as
 * 比较难看 — the same number was visually doubled (total chip "·N"
 * + tier pip "Ni") whenever a group was single-tier.
 *
 * R319: tier pip is now conditionally rendered with both
 *   `box.statuses.{tier} > 0` AND `box.statuses.{tier} !== box.count`
 * so single-tier groups collapse to `· N` (no duplicated digit).
 * Multi-tier groups keep all pips — the breakdown is genuinely
 * additional info there.
 *
 * Fixture:
 *   - alpha-1..alpha-3: all working (single-tier, count=3, working=3)
 *   - beta-1, beta-2: working; beta-3, beta-4: idle (multi-tier)
 *
 * Contract:
 *   - alpha group: no [data-group-pip="working"] tspan (dropped because
 *     working === count)
 *   - alpha group: still has [data-group-label-count] with value=3
 *     (R229 total chip untouched)
 *   - beta group: has [data-group-pip="working"] AND [data-group-pip="idle"]
 *     (multi-tier — both pips render because neither equals count)
 *   - beta group: [data-group-label-count-value]=4 still rendered
 *   - R317 inactive Layout toggle gray-400 + R318 active font-medium
 *     + R294 pulse absent all preserved.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    localStorage.setItem('anet-topo-layout', 'grid');
  } catch {}
});
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    // alpha — single-tier (all working, count=3)
    mk('alpha-1', 'working'),
    mk('alpha-2', 'working'),
    mk('alpha-3', 'working'),
    // beta — multi-tier (2 working + 2 idle, count=4)
    mk('beta-1', 'working'),
    mk('beta-2', 'working'),
    mk('beta-3', 'idle'),
    mk('beta-4', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 7, { timeout: 30000 });
await page.waitForSelector('[data-group-label-count]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(500);

const probe = await page.evaluate(() => {
  // Find each group's <text data-group-label> wrapper and its pip
  // children + count tspan.
  const labels = Array.from(document.querySelectorAll('[data-group-label]'));
  const byGroup = {};
  for (const label of labels) {
    const key = label.getAttribute('data-group-label');
    const countTspan  = label.querySelector('[data-group-label-count]');
    const pips        = Array.from(label.querySelectorAll('[data-group-pip]'));
    byGroup[key] = {
      hasCountTspan: !!countTspan,
      countValue:    countTspan?.getAttribute('data-group-label-count-value') ?? null,
      pipTiers:      pips.map(p => p.getAttribute('data-group-pip')),
      pipTexts:      pips.map(p => p.textContent),
    };
  }
  return {
    groups: byGroup,
    r317InactiveLayoutCls:
      document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    r317ActiveLayoutCls:
      document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount: document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

// R106 cluster algorithm preserves the trailing separator in the
// group key (e.g. alpha-1/2/3 → key 'alpha-'); match by prefix.
const alpha = probe.groups['alpha-'] || probe.groups['alpha'] || null;
const beta  = probe.groups['beta-']  || probe.groups['beta']  || null;

const results = {
  alpha_group_found:           alpha !== null,
  alpha_has_count_tspan:       alpha?.hasCountTspan === true,
  alpha_count_value_3:         alpha?.countValue === '3',
  alpha_no_working_pip:        !alpha?.pipTiers.includes('working'),
  alpha_no_pips_at_all:        alpha?.pipTiers.length === 0,
  beta_group_found:            beta !== null,
  beta_has_count_tspan:        beta?.hasCountTspan === true,
  beta_count_value_4:          beta?.countValue === '4',
  beta_has_working_pip:        beta?.pipTiers.includes('working'),
  beta_has_idle_pip:           beta?.pipTiers.includes('idle'),
  beta_no_offline_pip:         !beta?.pipTiers.includes('offline'),
  // R317 regression — Layout toggle inactive Grid is the layout-active
  // here (we forced grid via initScript), so check that Ring is the
  // INACTIVE one with text-gray-400. After R318, the ACTIVE button
  // (grid) has font-medium.
  r317_ring_inactive_gray_400: probe.r317ActiveLayoutCls.includes('text-gray-400'),
  r318_grid_active_font_medium: probe.r317InactiveLayoutCls.includes('font-medium'),
  r294_pulse_absent:           probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group-pip single-tier drop:`, JSON.stringify(results),
  '\n  alpha:', alpha,
  '\n  beta:',  beta);
process.exit(ok ? 0 : 1);
