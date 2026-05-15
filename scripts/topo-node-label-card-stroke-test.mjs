/* Round 217 verification: node label card stroke tints to
 * legendAccent (cyan) on parent-node hover, adding a 3rd hover-
 * feedback channel alongside R26 lift + R194 drop-shadow.
 *
 * Pre-R217 only 2 channels responded (translateY + drop-shadow);
 * stroke stayed constant at pal.labelBox.stroke. R217 adds the
 * 3rd channel for full hover-elevation triple coverage.
 *
 * Test (cyber dark, 4 working sessions = card mode):
 *   1. data-node-label-card present + 4 alias matches.
 *   2. Idle alpha: elevation='idle', stroke == pal.labelBox.stroke
 *      (NOT cyan)
 *   3. transition includes BOTH 'filter 220ms' AND 'stroke 220ms'
 *   4. Hover g[data-node="alpha"] → wait 250ms
 *   5. alpha elevation='hover', stroke shifted to legendAccent
 *      (cyan-leaning — B > R in computed color)
 *   6. Beta (non-hovered) card stroke STILL pal.labelBox.stroke
 *   7. Move away → alpha stroke back to pal.labelBox.stroke
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
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-node-label-card]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

const probe = async () => page.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-node-label-card]')];
  return cards.map(el => ({
    alias:      el.getAttribute('data-node-label-card'),
    elevation:  el.getAttribute('data-node-label-card-elevation'),
    stroke:     el.getAttribute('stroke'),
    computedStroke: getComputedStyle(el).stroke,
    transition: el.style.transition,
  }));
});

const idle = await probe();

await page.hover('g[data-node="alpha"]');
await page.waitForTimeout(260);
const hovered = await probe();

await page.mouse.move(0, 0);
await page.waitForTimeout(260);
const settled = await probe();

await browser.close();

// Detect "cyan-leaning" — RGB or OKLab parse, blue/teal axis dominant
function isCyanish(s) {
  if (!s) return false;
  let m = s.match(/rgba?\(\s*(\d+)\s*,?\s*(\d+)\s*,?\s*(\d+)/);
  if (m) {
    const r = +m[1], g = +m[2], b = +m[3];
    // cyan/teal: B and G both clearly > R
    return (b - r >= 50 && g - r >= 30) || (b > r + 60);
  }
  m = s.match(/oklab\(\s*([\-\d.]+)\s+([\-\d.]+)\s+([\-\d.]+)/);
  if (m) {
    const a = +m[2], b = +m[3];
    return a < -0.05 || b < -0.05;
  }
  m = s.match(/oklch\(\s*([\-\d.]+)\s+([\-\d.]+)\s+([\-\d.]+)/);
  if (m) {
    const h = +m[3];
    // cyan/teal hues are roughly 180-220 in OKLCH
    return h > 150 && h < 240 && parseFloat(m[2]) > 0.05;
  }
  m = s.match(/^#([0-9a-f]{6})/i);
  if (m) {
    const v = parseInt(m[1], 16);
    const r = (v >> 16) & 0xff, g = (v >> 8) & 0xff, b = v & 0xff;
    return b - r >= 50 && g - r >= 30;
  }
  return false;
}

const idleAlpha    = idle.find(c => c.alias === 'alpha');
const idleBeta     = idle.find(c => c.alias === 'beta');
const hovAlpha     = hovered.find(c => c.alias === 'alpha');
const hovBeta      = hovered.find(c => c.alias === 'beta');
const settledAlpha = settled.find(c => c.alias === 'alpha');

const results = {
  four_cards_present:           idle.length === 4,
  idle_alpha_elevation:         idleAlpha?.elevation === 'idle',
  idle_alpha_stroke_not_cyan:   !isCyanish(idleAlpha?.computedStroke),
  transition_has_filter:        /filter\s+(?:220ms|0\.22s)/.test(idleAlpha?.transition || ''),
  transition_has_stroke:        /stroke\s+(?:220ms|0\.22s)/.test(idleAlpha?.transition || ''),

  hover_alpha_elevation:        hovAlpha?.elevation === 'hover',
  hover_alpha_stroke_cyan:      isCyanish(hovAlpha?.computedStroke),
  hover_alpha_stroke_changed:   idleAlpha?.computedStroke !== hovAlpha?.computedStroke,
  hover_beta_stays_neutral:     hovBeta?.elevation === 'idle'
                                && !isCyanish(hovBeta?.computedStroke),

  settled_alpha_back_to_idle:   settledAlpha?.elevation === 'idle',
  settled_alpha_stroke_neutral: !isCyanish(settledAlpha?.computedStroke),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} node label card stroke:`, JSON.stringify(results),
  `\n  idleAlpha:`,    idleAlpha,
  `\n  hovAlpha:`,     hovAlpha,
  `\n  hovBeta:`,      hovBeta,
  `\n  settledAlpha:`, settledAlpha);
process.exit(ok ? 0 : 1);
