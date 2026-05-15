/* Round 195 verification: the recent-panel "+N more flows" footer
 * (R128/R133) adopts the cyan vocabulary on hover, joining
 * R178/R163/R179/R193 — "interactive-on-hover speaks cyan".
 *
 * Pre-R195 hover brightened opacity 0.55→0.85 + added underline but
 * kept fill = legendText (gray). R195 fills with legendAccent (cyan-
 * 400 dark / teal-600 light) on hover with a fill 200ms transition.
 *
 * Test (cyber/dark theme):
 *   1. Need > 3 flowLinks → mock 5 distinct alias pairs each with
 *      one message so flowLinks.length === 5.
 *   2. Footer renders, data-recent-panel-more='2' (5 - 3 visible),
 *      data-recent-panel-more-hovered='false' at idle.
 *   3. Idle fill is gray-ish (OKLab/Lab a,b ≈ 0); opacity ≈ 0.55.
 *   4. transition style includes 'fill 200ms' AND 'opacity 150ms'.
 *   5. Hover the footer <g> wrapper, wait past transition.
 *   6. data-recent-panel-more-hovered flips to 'true'.
 *   7. Fill leans cyan (OKLab/Lab a < 0 OR b < 0); opacity ≈ 0.85.
 *   8. Move away, fill returns to gray, opacity back to ~0.55.
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
    alias, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});

// 5 distinct alias pairs → flowLinks.length === 5 → footer "+2 more flows"
const now = Date.now();
const msgs = [
  { id: '1', from_alias: 'alpha', to_alias: 'beta',  content: 'hi', network_id: 'default', created_at: new Date(now - 1000).toISOString() },
  { id: '2', from_alias: 'beta',  to_alias: 'gamma', content: 'hi', network_id: 'default', created_at: new Date(now - 2000).toISOString() },
  { id: '3', from_alias: 'gamma', to_alias: 'delta', content: 'hi', network_id: 'default', created_at: new Date(now - 3000).toISOString() },
  { id: '4', from_alias: 'delta', to_alias: 'alpha', content: 'hi', network_id: 'default', created_at: new Date(now - 4000).toISOString() },
  { id: '5', from_alias: 'alpha', to_alias: 'gamma', content: 'hi', network_id: 'default', created_at: new Date(now - 5000).toISOString() },
];
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-recent-panel-more]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = async () => page.evaluate(() => {
  const el = document.querySelector('[data-recent-panel-more]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    moreCount:  el.getAttribute('data-recent-panel-more'),
    hovered:    el.getAttribute('data-recent-panel-more-hovered'),
    fill:       cs.fill,
    opacity:    parseFloat(cs.opacity),
    transition: cs.transitionProperty + ' / ' + cs.transitionDuration,
    textDeco:   cs.textDecorationLine || el.getAttribute('text-decoration'),
  };
});

const idle = await probe();

await page.hover('[data-recent-panel-more-nav]');
await page.waitForTimeout(250);
const hovered = await probe();

await page.mouse.move(0, 0);
await page.waitForTimeout(400);  // past 200ms fill + 150ms opacity transitions with margin
const settled = await probe();

await browser.close();

// slate-400 (legendText) = rgb(148,163,184) — B-R only 36, so a B>R+30
// threshold misclassifies muted slate as "cyan". cyan-400 (legendAccent)
// = rgb(34,211,238) and our snapshot here = rgb(107,226,243): B-R ≈ 136.
// Use a tighter threshold (>=80) and a saturation gate (chroma) so the
// gray-blue slate doesn't read as cyan but saturated cyan does.
function parseColor(s) {
  if (!s) return null;
  let m;
  m = s.match(/rgba?\(\s*(\d+)\s*,?\s*(\d+)\s*,?\s*(\d+)/);
  if (m) {
    const r = +m[1], g = +m[2], b = +m[3];
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    return {
      kind: 'rgb', r, g, b, chroma,
      cyanish: b - r >= 80 && chroma > 80,    // saturated blue/cyan
      neutralish: Math.abs(b - r) < 50 && chroma < 70,
    };
  }
  m = s.match(/(?:oklab|lab)\(\s*([\-\d.]+)\s+([\-\d.]+)\s+([\-\d.]+)/);
  if (m) {
    const L = +m[1], a = +m[2], b = +m[3];
    const scale = Math.max(Math.abs(a), Math.abs(b)) > 5 ? 'lab' : 'oklab';
    const thr  = scale === 'lab' ? 15 : 0.08;
    const ntrl = scale === 'lab' ? 8  : 0.04;
    return {
      kind: scale, L, a, b,
      cyanish: (a < -thr || b < -thr),
      neutralish: Math.abs(a) < ntrl && Math.abs(b) < ntrl,
    };
  }
  return null;
}
const idleColor    = parseColor(idle?.fill);
const hoverColor   = parseColor(hovered?.fill);
const settledColor = parseColor(settled?.fill);

const results = {
  footer_present:           !!idle,
  more_count_2:             idle?.moreCount === '2',
  idle_not_hovered:         idle?.hovered === 'false',
  idle_fill_neutral:        idleColor?.neutralish === true,
  idle_opacity_low:         idle?.opacity > 0.45 && idle?.opacity < 0.65,
  transition_has_fill:      (idle?.transition || '').includes('fill') && (idle?.transition || '').includes('0.2s'),
  transition_has_opacity:   (idle?.transition || '').includes('opacity') && (idle?.transition || '').includes('0.15s'),

  hover_attr_true:          hovered?.hovered === 'true',
  hover_fill_cyan:          hoverColor?.cyanish === true,
  hover_opacity_high:       hovered?.opacity > 0.75 && hovered?.opacity < 0.95,
  hover_fill_changed:       idle?.fill !== hovered?.fill,

  settled_attr_false:       settled?.hovered === 'false',
  settled_fill_neutral:     settledColor?.neutralish === true,
  settled_opacity_low:      settled?.opacity > 0.45 && settled?.opacity < 0.65,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-panel-more cyan hover:`, JSON.stringify(results),
  `\n  idle:`,    idle,    `\n   idleColor:`,    idleColor,
  `\n  hovered:`, hovered, `\n   hoverColor:`,   hoverColor,
  `\n  settled:`, settled, `\n   settledColor:`, settledColor);
process.exit(ok ? 0 : 1);
