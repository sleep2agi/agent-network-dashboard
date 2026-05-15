/* Round 162 verification: recent-signal panel header "N flows"
 * tspan picks up the R160/R161 freshness vocabulary.
 *
 * R10  fades canvas edge by freshness (per-edge stroke opacity)
 * R160 brought it to the recent-signal panel rows (per-flow pip)
 * R161 brought it to the chip-row "active links" chip bullet
 *      (fleet aggregate in the chip-row above the SVG)
 * R162 brings it to the recent-signal panel HEADER count
 *      (fleet aggregate inside the SVG corner)
 *
 * The chip-row "N active links · last 5s" and the panel-header
 * "N flows" show the same metric at two scopes. R161 tinted the
 * chip-row side; R162 tints the panel-side mirror so both
 * scopes speak the same freshness vocabulary side-by-side.
 *
 * Same alpha ramp as R160/R161:
 *   ageSec ≤ 30   → 1.0  (fully fresh)
 *   30-300s       → smooth decay 1.0 → 0.25
 *   > 300s        → 0.25 stale floor
 *
 * Hot tail (R129 amber " · N hot") is volume-tinted and stays
 * unchanged — recency tints the head; volume colors the tail.
 *
 * Test: 3 page loads, 5s / 90s / 360s ago.
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

async function probe(msgAgeSec) {
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
    await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta')] } });
  });
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
    { id: 'x', from_alias: 'alpha', to_alias: 'beta', content: 'hi',
      network_id: 'default', created_at: new Date(Date.now() - msgAgeSec * 1000).toISOString() },
  ] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 2, { timeout: 30000 });
  await page.waitForSelector('[data-recent-panel-count]', { timeout: 10000 });
  await page.waitForTimeout(400);
  const out = await page.evaluate(() => {
    const el = document.querySelector('[data-recent-panel-count]');
    if (!el) return null;
    // SVG tspan fill attribute is the source of truth — getComputedStyle on
    // tspan returns nothing useful on some browsers.
    return {
      alpha: parseFloat(el.getAttribute('data-recent-panel-count-freshness-alpha') || ''),
      fill:  el.getAttribute('fill') || '',
      text:  el.textContent,
    };
  });
  await page.close();
  return out;
}

const A = await probe(5);     // fresh
const B = await probe(90);    // mid
const C = await probe(360);   // stale

await browser.close();

const cyanRgb = (str) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(str);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};

const results = {
  fresh_dot_found:    A !== null,
  mid_dot_found:      B !== null,
  stale_dot_found:    C !== null,
  fresh_alpha_1:      A && Math.abs(A.alpha - 1.0)  < 0.05,
  mid_alpha_window:   B && B.alpha > 0.7 && B.alpha < 0.95,
  stale_alpha_floor:  C && Math.abs(C.alpha - 0.25) < 0.05,
  fresh_color_cyan:   A && JSON.stringify(cyanRgb(A.fill)) === '[34,211,238]',
  stale_alpha_in_fill: C && /0\.25/.test(C.fill),
  ladder_descends:    A && B && C && A.alpha > B.alpha && B.alpha > C.alpha,
  text_says_1_flow:   A && /1 flow/.test(A.text || ''),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} panel-header count freshness:`, JSON.stringify(results),
  `\n  fresh =`, A,
  `\n  mid   =`, B,
  `\n  stale =`, C);
process.exit(ok ? 0 : 1);
