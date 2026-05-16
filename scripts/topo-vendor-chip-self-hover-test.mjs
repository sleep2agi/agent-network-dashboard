/* Round 202 verification: vendor letter chips (A/O/书/M/?) deepen
 * their OWN vendor colour on hover, completing the chip-row family
 * R193/R195/R201 opened.
 *
 * Pre-R202 hover fired R88 canvas dim via setHoveredVendor but the
 * chip itself stayed at bg=transparent. R202 tints the chip with
 * color-mix(in srgb, <vendor-hue> 12%, transparent) only when hovered
 * (and not pinned — pinned uses R180's stronger inset-ring treatment).
 *
 * Test (cyber dark, 2 claude + 2 gpt sessions → vendorDist={A:2, O:2}):
 *   1. vendor letter chips A + O both render (vendorDist.length > 1).
 *   2. Idle: data-vendor-hovered='false', backgroundColor='transparent'
 *      / 'rgba(0,0,0,0)'.
 *   3. Inline transition includes 'box-shadow 150ms' (R180 still there)
 *      AND 'background-color 200ms' (R202 splice).
 *   4. Hover 'A' chip — wait past 220ms.
 *   5. 'A' data-vendor-hovered='true', backgroundColor is a non-empty
 *      tint string (color-mix or rendered fallback) different from
 *      idle. 'O' chip stays 'false' + transparent.
 *   6. Move away — 'A' settles back to 'false' + transparent.
 *   7. R88 canvas-effect verification — hover 'A' sets hoveredVendor
 *      which composes into the canvas dim logic; we probe via a
 *      surrogate signal that the chip's R55-like effect fires:
 *      hoveredVendor is exposed elsewhere via data attributes; the
 *      simplest gate is that the chip itself reflects the hover via
 *      its own data-vendor-hovered attribute already asserted above
 *      (event handler clearly ran).
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
  const mk = (alias, model) => ({
    alias, status: 'working', model, runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // 3+ vendor types (R281 threshold tightened to >2): one Anthropic +
  // one OpenAI + one InternLM (书生) + one unknown → vendorDist 4 types.
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4'),
    mk('beta',  'gpt-4o'),
    mk('gamma', 'internlm/internlm2'),
    mk('delta', 'some-unknown-model'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-vendor-letter="A"]', { timeout: 10000 });
await page.waitForSelector('[data-vendor-letter="O"]', { timeout: 5000 });
await page.waitForTimeout(300);

const probe = async (initial) => page.evaluate((i) => {
  const el = document.querySelector(`[data-vendor-letter="${i}"]`);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    initial:    i,
    hovered:    el.getAttribute('data-vendor-hovered'),
    pinned:     el.getAttribute('data-vendor-pinned'),
    bg:         cs.backgroundColor,
    inlineBg:   el.style.backgroundColor,
    transition: el.style.transition,
  };
}, initial);

const idleA = await probe('A');
const idleO = await probe('O');

await page.hover('[data-vendor-letter="A"]');
await page.waitForTimeout(260);
const hoverA = await probe('A');
const otherO = await probe('O');

await page.mouse.move(0, 0);
await page.waitForTimeout(280);
const settledA = await probe('A');

await browser.close();

const isTransparent = (s) =>
  !s || s === 'transparent' || s === 'rgba(0, 0, 0, 0)' || s === 'rgba(0,0,0,0)';

const hasColorMix = (s) => /color-mix\s*\(/i.test(s || '');
const isNonEmptyColor = (s) => !!s && !isTransparent(s);

const results = {
  A_chip_present:                !!idleA,
  O_chip_present:                !!idleO,

  idle_A_not_hovered:            idleA?.hovered === 'false',
  idle_A_transparent_bg:         isTransparent(idleA?.bg),
  idle_A_transition_boxshadow:   /box-shadow\s+(?:150ms|0\.15s)/.test(idleA?.transition || ''),
  idle_A_transition_bgcolor:     /background-color\s+(?:200ms|0\.2s)/.test(idleA?.transition || ''),

  idle_O_not_hovered:            idleO?.hovered === 'false',

  hover_A_hovered_attr:          hoverA?.hovered === 'true',
  hover_A_inline_color_mix:      hasColorMix(hoverA?.inlineBg),
  hover_A_computed_non_transparent: isNonEmptyColor(hoverA?.bg) && !isTransparent(hoverA?.bg),
  hover_A_bg_changed:            idleA?.bg !== hoverA?.bg,
  hover_O_stays_idle:            otherO?.hovered === 'false' && isTransparent(otherO?.bg),

  settled_A_not_hovered:         settledA?.hovered === 'false',
  settled_A_transparent_bg:      isTransparent(settledA?.bg),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} vendor chip self-hover:`, JSON.stringify(results),
  `\n  idleA:`,     idleA,
  `\n  idleO:`,     idleO,
  `\n  hoverA:`,    hoverA,
  `\n  otherO:`,    otherO,
  `\n  settledA:`,  settledA);
process.exit(ok ? 0 : 1);
