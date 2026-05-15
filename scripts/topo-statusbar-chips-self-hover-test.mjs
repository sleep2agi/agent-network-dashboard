/* Round 201 verification: the chip-row "N working" / "N online" chips
 * adopt deeper versions of their own identity colour on hover,
 * mirroring R193 active-links chip pattern.
 *
 * Pre-R201 hover working chip → R55 canvas dim + chip-row highlight,
 * but chip itself stayed at bg-{color}-500/10 — cause silent, effect
 * loud. R201 deepens 10→15 bg and 20→30 border on hover (only when
 * the chip has a target count > 0). The inline transition list is
 * extended to cover background-color + border-color so the swap
 * eases instead of snapping (Tailwind transition-colors on the
 * className alone would be overridden by the existing R180 inline
 * box-shadow transition).
 *
 * Test (cyber dark, 4 working sessions):
 *   1. Working chip: clickable='true', className has hover:bg-green-500/15
 *      + hover:border-green-500/30, transition includes 'background-color'
 *      + 'border-color' (both 200ms), inline still has 'box-shadow 150ms'.
 *   2. Online chip: same shape with cyan hue.
 *   3. Hover the working chip — wait past 220ms → computed bg
 *      shifts to a more-saturated/darker green (RGB-or-OKLab signal).
 *   4. Move away — bg returns to idle (with margin past 220ms).
 *   5. The chip's R55 canvas-effect setHoveredStatus still fires —
 *      verified via hoveredStatus change reflected on the working
 *      legend row's data-legend-row-lifted attribute.
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
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-working-chip]', { timeout: 10000 });
await page.waitForTimeout(300);

const probeChip = async (selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    className:   el.getAttribute('class') || '',
    clickable:   el.getAttribute('data-working-chip-clickable') ||
                 el.getAttribute('data-online-chip-clickable'),
    bg:          cs.backgroundColor,
    borderColor: cs.borderTopColor,
    transition:  el.style.transition,
  };
}, selector);

const idleWorking = await probeChip('[data-working-chip]');
const idleOnline  = await probeChip('[data-online-chip]');

await page.hover('[data-working-chip]');
await page.waitForTimeout(250);
const hoverWorking = await probeChip('[data-working-chip]');

// Confirm R55 canvas effect still fires — hoveredStatus='working'
// lifts the legend working row.
const workingRowLifted = await page.evaluate(() =>
  document.querySelector('[data-legend-status="working"]')
    ?.getAttribute('data-legend-row-lifted'));

await page.mouse.move(0, 0);
await page.waitForTimeout(280);
const settledWorking = await probeChip('[data-working-chip]');

await page.hover('[data-online-chip]');
await page.waitForTimeout(250);
const hoverOnline = await probeChip('[data-online-chip]');

await page.mouse.move(0, 0);
await page.waitForTimeout(280);
const settledOnline = await probeChip('[data-online-chip]');

await browser.close();

// Tailwind 4 emits oklab/oklch / color-mix forms. Just check the bg
// string actually differs idle vs hover, and a brief parser confirms
// the channel that should grow (green for working, blue/green for cyan).
// Parse colors including alpha. R201's Tailwind /10 → /15 emits same
// OKLab L/a/b with stepped-up alpha (0.1 → 0.15); R193's gray→cyan
// pattern emits a different hue at any alpha. Both are "more saturated
// against the canvas" from the user's POV. Capture alpha and treat
// alpha-increase as a valid saturation signal alongside chroma growth.
function parseColor(s) {
  if (!s) return null;
  let m = s.match(/rgba?\(\s*(\d+)\s*,?\s*(\d+)\s*,?\s*(\d+)(?:\s*[,/]\s*([\d.]+))?/);
  if (m) return { kind: 'rgb', r: +m[1], g: +m[2], b: +m[3], a: m[4] != null ? +m[4] : 1 };
  m = s.match(/oklab\(\s*([\-\d.]+)\s+([\-\d.]+)\s+([\-\d.]+)(?:\s*\/\s*([\d.]+))?/);
  if (m) return { kind: 'oklab', L: +m[1], a: +m[2], b: +m[3], alpha: m[4] != null ? +m[4] : 1 };
  m = s.match(/oklch\(\s*([\-\d.]+)\s+([\-\d.]+)\s+([\-\d.]+)(?:\s*\/\s*([\d.]+))?/);
  if (m) return { kind: 'oklch', L: +m[1], C: +m[2], h: +m[3], alpha: m[4] != null ? +m[4] : 1 };
  return null;
}

// "More saturated against the canvas" = either chroma/hue distance
// from gray grew OR alpha grew (Tailwind /10 → /15 deepens by alpha).
const moreSaturated = (idle, hov) => {
  if (!idle || !hov) return false;
  if (idle.kind === 'rgb' && hov.kind === 'rgb') {
    const chromaIdle = Math.max(idle.r, idle.g, idle.b) - Math.min(idle.r, idle.g, idle.b);
    const chromaHov  = Math.max(hov.r, hov.g, hov.b) - Math.min(hov.r, hov.g, hov.b);
    return chromaHov > chromaIdle || hov.a > idle.a + 0.01;
  }
  if (idle.kind === 'oklab' && hov.kind === 'oklab') {
    const dIdle = Math.hypot(idle.a, idle.b);
    const dHov  = Math.hypot(hov.a, hov.b);
    return dHov > dIdle + 0.005 || hov.alpha > idle.alpha + 0.01;
  }
  if (idle.kind === 'oklch' && hov.kind === 'oklch') {
    return hov.C > idle.C + 0.005 || hov.alpha > idle.alpha + 0.01;
  }
  return false;
};

const idleWorkingC = parseColor(idleWorking?.bg);
const hoverWorkingC = parseColor(hoverWorking?.bg);
const idleOnlineC  = parseColor(idleOnline?.bg);
const hoverOnlineC = parseColor(hoverOnline?.bg);

const results = {
  working_clickable:                   idleWorking?.clickable === 'true',
  working_className_has_hover:         idleWorking?.className.includes('hover:bg-green-500/15')
                                       && idleWorking?.className.includes('hover:border-green-500/30'),
  working_transition_includes_bg:      /background-color\s+(?:200ms|0\.2s)/.test(idleWorking?.transition || ''),
  working_transition_includes_border:  /border-color\s+(?:200ms|0\.2s)/.test(idleWorking?.transition || ''),
  working_transition_keeps_boxshadow:  /box-shadow\s+(?:150ms|0\.15s)/.test(idleWorking?.transition || ''),
  working_hover_bg_changed:            idleWorking?.bg !== hoverWorking?.bg,
  working_hover_more_saturated:        moreSaturated(idleWorkingC, hoverWorkingC),
  working_settles_back:                settledWorking?.bg === idleWorking?.bg,
  // R55 canvas-effect still fires from the chip — hovering the
  // working chip lifts the legend working row.
  working_canvas_effect_fires:         workingRowLifted === 'true',

  online_clickable:                    idleOnline?.clickable === 'true',
  online_className_has_hover:          idleOnline?.className.includes('hover:bg-cyan-500/15')
                                       && idleOnline?.className.includes('hover:border-cyan-500/30'),
  online_transition_includes_bg:       /background-color\s+(?:200ms|0\.2s)/.test(idleOnline?.transition || ''),
  online_transition_includes_border:   /border-color\s+(?:200ms|0\.2s)/.test(idleOnline?.transition || ''),
  online_hover_bg_changed:             idleOnline?.bg !== hoverOnline?.bg,
  online_hover_more_saturated:         moreSaturated(idleOnlineC, hoverOnlineC),
  online_settles_back:                 settledOnline?.bg === idleOnline?.bg,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} status-bar chips self-hover:`, JSON.stringify(results),
  `\n  idleWorking:`,    idleWorking,
  `\n  hoverWorking:`,   hoverWorking,
  `\n  settledWorking:`, settledWorking,
  `\n  idleOnline:`,     idleOnline,
  `\n  hoverOnline:`,    hoverOnline,
  `\n  settledOnline:`,  settledOnline);
process.exit(ok ? 0 : 1);
