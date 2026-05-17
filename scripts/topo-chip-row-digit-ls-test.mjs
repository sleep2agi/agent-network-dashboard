/* Round 539 verification: chip-row digit (working/online/active-links)
 * gains group-hover:tracking-wide alongside existing R362 group-hover:
 * font-bold. Hover-letter-spacing family 12th anchor across 3 siblings.
 *
 * Test phases:
 *   1. rest each chip-digit: computed letterSpacing='normal' (=0)
 *   2. hover the chip's parent (has `group` class — sets group-hover):
 *      digit's letterSpacing = ~0.025em
 *   3. source-side regex confirms all 3 digits have the new class
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
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
    mk('a·1', 'working'), mk('a·2', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: {
  messages: [{ id: 'm1', from_alias: 'a·1', to_alias: 'a·2', content: 't', created_at: fresh }]
} }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-working-chip-digit]', { timeout: 15000 });
await page.waitForTimeout(800);

async function probe(digitSel, chipParentSel) {
  const rest = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    return { ls: getComputedStyle(el).letterSpacing };
  }, digitSel);
  await page.hover(chipParentSel);
  await page.waitForTimeout(350);
  const hover = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    return { ls: getComputedStyle(el).letterSpacing };
  }, digitSel);
  // move pointer away for next probe
  await page.mouse.move(50, 50);
  await page.waitForTimeout(200);
  return { rest, hover };
}

// The chip-row chip <span class="group ...">; each has parent with `group`.
// Hover the chip's parent span — its child digit gets group-hover effects.
// The chip parent is the closest ancestor with `group` class. Easier: find
// the digit and walk up to nearest `.group` element via JS.
async function hoverChipDigit(sel) {
  const handle = await page.evaluateHandle((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    let p = el.parentElement;
    while (p && !p.classList.contains('group')) p = p.parentElement;
    return p;
  }, sel);
  return handle;
}

async function probeChip(digitSel) {
  const rest = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    return { ls: getComputedStyle(el).letterSpacing };
  }, digitSel);
  const groupHandle = await hoverChipDigit(digitSel);
  await groupHandle.asElement()?.hover();
  await page.waitForTimeout(350);
  const hover = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    return { ls: getComputedStyle(el).letterSpacing };
  }, digitSel);
  await page.mouse.move(50, 50);
  await page.waitForTimeout(200);
  return { rest, hover };
}

const working    = await probeChip('[data-working-chip-digit]');
const online     = await probeChip('[data-online-chip-digit]');
const activeLinks = await probeChip('[data-active-links-chip-digit]');

await browser.close();

// Source regex — all 3 chip digits should carry the new class string
const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWorking = /class[Nn]ame="font-semibold transition-\[font-weight,letter-spacing\] duration-200 group-hover:font-bold group-hover:tracking-wide" data-working-chip-digit/.test(src);
const sourceOnline = /class[Nn]ame="font-semibold transition-\[font-weight,letter-spacing\] duration-200 group-hover:font-bold group-hover:tracking-wide" data-online-chip-digit/.test(src);
const sourceAL = /class[Nn]ame="font-semibold transition-\[font-weight,letter-spacing\] duration-200 group-hover:font-bold group-hover:tracking-wide" data-active-links-chip-digit/.test(src);

const isRestLS = (r) => r?.ls === 'normal' || r?.ls === '0px';
// tracking-wide = 0.025em; on text-xs (12px) digit ≈ 0.3px (varies with computed font-size)
const isHoverLS = (r) => r?.ls && r.ls !== 'normal' && r.ls !== '0px' && parseFloat(r.ls) > 0.1;

const results = {
  working_rest_normal:  isRestLS(working?.rest),
  working_hover_wide:   isHoverLS(working?.hover),
  online_rest_normal:   isRestLS(online?.rest),
  online_hover_wide:    isHoverLS(online?.hover),
  active_rest_normal:   isRestLS(activeLinks?.rest),
  active_hover_wide:    isHoverLS(activeLinks?.hover),
  source_working:       sourceWorking,
  source_online:        sourceOnline,
  source_active_links:  sourceAL,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R539 chip-row digit hover-tracking:`,
  JSON.stringify(results, null, 2),
  '\n  working:', JSON.stringify(working),
  '\n  online:', JSON.stringify(online),
  '\n  active-links:', JSON.stringify(activeLinks));
process.exit(ok ? 0 : 1);
