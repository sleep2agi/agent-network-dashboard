/* Round 193 verification: the active-links chip itself responds to
 * hover by adopting a cyan tint, mirroring the canvas-edge highlight
 * it already fires (which R77's topo-active-links-chip-hover-test
 * verifies). Two different surfaces:
 *   R77  test → canvas edges (effect element)
 *   R193 test → chip itself  (cause element)
 *
 * Pre-R193 the chip stayed gray when hovered while the canvas edges
 * brightened to cyan — cause-element silent, effect-element loud.
 * R193 attaches a Tailwind :hover variant (cyan-500/10 bg, cyan-200
 * text, cyan-500/30 border) when the chip is interactive, plus a
 * transition-colors duration-200 for smooth blend. Non-interactive
 * chips (0 active links) keep the gray-only variant.
 *
 * Test scenarios:
 *   A. Interactive (3 flows):
 *      1. Idle: bg near gray-500/10 (R,G,B close to each other)
 *      2. className includes 'hover:bg-cyan-500/10'
 *      3. Hover: bg, text, border all shift cyan (B > R)
 *      4. transition-colors duration-200 present
 *      5. bg actually changed from idle to hover
 *   B. Non-interactive (0 flows):
 *      6. className does NOT include 'hover:bg-cyan-500/10'
 *      7. data-active-links-clickable='false'
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

async function load(flowsScenario) {
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
  const msgs = flowsScenario(now);
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
  await page.waitForSelector('[data-active-links-chip]', { timeout: 10000 });
  await page.waitForTimeout(400);
  return page;
}

// Scenario A: 3 flows (interactive)
const pageA = await load((now) => [
  { id: '1', from_alias: 'alpha', to_alias: 'beta',  content: 'hi',
    network_id: 'default', created_at: new Date(now - 5000).toISOString() },
  { id: '2', from_alias: 'beta',  to_alias: 'gamma', content: 'hi',
    network_id: 'default', created_at: new Date(now - 8000).toISOString() },
  { id: '3', from_alias: 'gamma', to_alias: 'delta', content: 'hi',
    network_id: 'default', created_at: new Date(now - 11000).toISOString() },
]);

const idleA = await pageA.evaluate(() => {
  const el = document.querySelector('[data-active-links-chip]');
  const cs = getComputedStyle(el);
  return {
    className:  el.getAttribute('class') || '',
    clickable:  el.getAttribute('data-active-links-clickable'),
    flowCount:  el.getAttribute('data-active-links-flow-count'),
    bg:         cs.backgroundColor,
    color:      cs.color,
    borderColor:cs.borderTopColor,
    transition: cs.transitionProperty + ' / ' + cs.transitionDuration,
  };
});

await pageA.hover('[data-active-links-chip]');
await pageA.waitForTimeout(280);  // longer than 200ms transition

const hoverA = await pageA.evaluate(() => {
  const el = document.querySelector('[data-active-links-chip]');
  const cs = getComputedStyle(el);
  return {
    bg:         cs.backgroundColor,
    color:      cs.color,
    borderColor:cs.borderTopColor,
  };
});

await pageA.mouse.move(0, 0);
await pageA.waitForTimeout(50);
await pageA.close();

// Scenario B: 0 flows (non-interactive)
const pageB = await load(() => []);
const idleB = await pageB.evaluate(() => {
  const el = document.querySelector('[data-active-links-chip]');
  return {
    className: el.getAttribute('class') || '',
    clickable: el.getAttribute('data-active-links-clickable'),
    flowCount: el.getAttribute('data-active-links-flow-count'),
  };
});
await pageB.close();
await browser.close();

// Tailwind 4 emits modern color spaces (oklab / lab). Cyan in OKLab
// is characterised by a<0 (green-leaning) AND b<0 (blue-leaning).
// Gray has a ≈ 0, b ≈ 0. Lab uses similar axes at different scales.
function parseLab(s) {
  const m = (s || '').match(/(?:oklab|lab)\(\s*([\-\d.]+)\s+([\-\d.]+)\s+([\-\d.]+)/);
  return m ? { L: +m[1], a: +m[2], b: +m[3] } : null;
}
const idleBgLab  = parseLab(idleA.bg);
const hoverBgLab = parseLab(hoverA.bg);
const hoverFgLab = parseLab(hoverA.color);
const hoverBdLab = parseLab(hoverA.borderColor);
const idleFgLab  = parseLab(idleA.color);

// Cyan-leaning thresholds: a more negative by at least 0.05 (OKLab)
// or 5 (Lab), b similarly. Robust to either color space.
const isMoreCyan = (idle, hov) =>
  hov && idle && (hov.a < idle.a - 0.04 || hov.b < idle.b - 0.04 || hov.a < -0.05 || hov.b < -0.05);

const results = {
  // A1: idle is roughly gray-ish — small a,b deviation from 0
  idleA_gray_bg:        idleBgLab && Math.abs(idleBgLab.a) < 0.05 && Math.abs(idleBgLab.b) < 0.05,

  // A2: className has hover variant
  idleA_has_hover:      idleA.className.includes('hover:bg-cyan-500/10'),

  // A3: hovered surfaces lean cyan vs idle
  hover_bg_cyan:        isMoreCyan(idleBgLab, hoverBgLab),
  hover_text_cyan:      isMoreCyan(idleFgLab, hoverFgLab),
  hover_border_cyan:    isMoreCyan(idleBgLab, hoverBdLab),

  // bg actually changed
  bg_changed:           idleA.bg !== hoverA.bg,

  // A4: transition-colors duration-200 present
  idleA_has_transition: idleA.transition.includes('color') && idleA.transition.includes('0.2s'),
  idleA_clickable_true: idleA.clickable === 'true',
  idleA_flow_count_3:   idleA.flowCount === '3',

  // B6: non-interactive chip has NO hover variant
  idleB_no_hover:       !idleB.className.includes('hover:bg-cyan-500/10'),
  idleB_clickable_false:idleB.clickable === 'false',
  idleB_flow_count_0:   idleB.flowCount === '0',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} active-links chip self-hover:`, JSON.stringify(results),
  `\n  idleA:`,  idleA,
  `\n  hoverA:`, hoverA,
  `\n  idleB:`,  idleB);
process.exit(ok ? 0 : 1);
