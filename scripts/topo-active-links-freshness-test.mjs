/* Round 161 verification: active-links chip bullet picks up
 * the R160 freshness vocabulary.
 *
 * R10 fades canvas flow edges by freshness. R160 brought that
 * vocabulary to the recent-signal panel rows via a 1.6-px cyan
 * pip at row left edge. R161 extends it one more scope — up to
 * the fleet-aggregate active-links chip in the chip-row.
 *
 * The chip text was already "3 active links · last 5s ago" but
 * the " · " separator was dead gray. R161 colors that bullet
 * by freshness using the same alpha ramp:
 *   ageSec ≤ 30   → 1.0 (fully fresh)
 *   30-300s       → 1.0 → 0.25 smooth decay
 *   > 300s        → 0.25 stale floor
 *
 * Three nested scopes now share one freshness ladder:
 *   canvas edge fade  (R10)   — per-edge visual
 *   row pip           (R160)  — per-flow row in recent-signal
 *   chip bullet       (R161)  — fleet aggregate in chip-row
 *
 * Test scenarios (one page load each):
 *   A. fresh most-recent flow (5s ago)  → alpha ≈ 1.0, fontWeight 700
 *   B. mid recency (90s ago)            → alpha ≈ 0.83
 *   C. stale (360s ago)                 → alpha ≈ 0.25 (floor)
 *
 * Color parses out of `rgba(34, 211, 238, 1)` cyber theme.
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
  await page.waitForSelector('[data-active-links-freshness-dot]', { timeout: 10000 });
  await page.waitForTimeout(400);
  const out = await page.evaluate(() => {
    const el = document.querySelector('[data-active-links-freshness-dot]');
    if (!el) return null;
    const styleColor = el.style.color || getComputedStyle(el).color;
    return {
      alpha: parseFloat(el.getAttribute('data-active-links-freshness-alpha') || ''),
      color: styleColor,
      fontWeight: el.style.fontWeight || getComputedStyle(el).fontWeight,
      text: el.textContent,
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
  // Inline `style="color: rgba(34, 211, 238, ...)"` — alpha is part of color.
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
  fresh_color_cyan:   A && JSON.stringify(cyanRgb(A.color)) === '[34,211,238]',
  fresh_weight_bold:  A && (A.fontWeight === '700' || A.fontWeight === 'bold'),
  stale_weight_norm:  C && (C.fontWeight === '400' || C.fontWeight === 'normal' || C.fontWeight === ''),
  ladder_descends:    A && B && C && A.alpha > B.alpha && B.alpha > C.alpha,
  text_is_separator:  A && A.text && A.text.trim() === '·',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} active-links freshness:`, JSON.stringify(results),
  `\n  fresh =`, A,
  `\n  mid   =`, B,
  `\n  stale =`, C);
process.exit(ok ? 0 : 1);
