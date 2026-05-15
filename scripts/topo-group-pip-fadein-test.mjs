/* Round 207 verification: group box label status pip tspans
 * (`2w`, `1i`, `1o`) get anet-fade-in on mount. Pre-R207 a tier
 * crossing 0 → 1+ snap-popped its tspan into the group label;
 * R207 eases the entrance the same way R203 did for recent rows.
 *
 * Group boxes only render in grid layout when sessions share a
 * ≥2-char alias prefix (computeGroups union-find).
 *
 * Test:
 *   Mock 4 sessions: alpha-1 working, alpha-2 idle, beta-1 working,
 *   beta-2 working. Two groups form:
 *     alpha · 1 working + 1 idle (both pips fire)
 *     beta  · 2 working          (only working pip fires)
 *   Switch to grid layout via the R163 toggle, wait for group boxes.
 *   Probe:
 *     1. >=3 [data-group-pip] elements present (alpha working +
 *        alpha idle + beta working)
 *     2. No [data-group-pip="offline"] (offline tier is empty)
 *     3. Every pip's className includes 'anet-fade-in'
 *     4. CSS animationName resolves to 'anet-fade-in'
 *     5. tspan textContent matches digit+letter pattern (e.g.
 *        '2w', '1i')
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
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha-1', 'working'),
    mk('alpha-2', 'idle'),
    mk('beta-1',  'working'),
    mk('beta-2',  'working'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-topo-chrome-layout="grid"]', { timeout: 10000 });
await page.waitForTimeout(200);

// Switch to grid layout to trigger groupBoxes rendering
await page.click('[data-topo-chrome-layout="grid"]');
await page.waitForTimeout(600);  // R170 layout-switch crossfade + group derivation
await page.waitForSelector('[data-group-pip]', { timeout: 5000 });
await page.waitForTimeout(300);

const pips = await page.evaluate(() => {
  return [...document.querySelectorAll('[data-group-pip]')].map(el => {
    const cs = getComputedStyle(el);
    return {
      tier:          el.getAttribute('data-group-pip'),
      text:          el.textContent,
      className:     el.getAttribute('class') || '',
      animationName: cs.animationName,
    };
  });
});

await browser.close();

const working = pips.filter(p => p.tier === 'working');
const idleP   = pips.filter(p => p.tier === 'idle');
const offline = pips.filter(p => p.tier === 'offline');

const has = (s, c) => (s || '').split(/\s+/).includes(c);

const results = {
  at_least_three_pips:       pips.length >= 3,
  has_working_pip:            working.length >= 2,  // alpha + beta both have working
  has_idle_pip:               idleP.length >= 1,    // alpha has 1 idle
  no_offline_pip:             offline.length === 0,
  all_have_fadein_class:      pips.every(p => has(p.className, 'anet-fade-in')),
  all_have_animation_bound:   pips.every(p => /anet-fade-in/i.test(p.animationName)),
  text_format_correct:        pips.every(p => /^\d+[wio]$/.test(p.text || '')),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group pip fade-in:`, JSON.stringify(results),
  `\n  pips:`, pips);
process.exit(ok ? 0 : 1);
