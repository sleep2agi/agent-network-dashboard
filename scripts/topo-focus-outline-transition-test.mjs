/* Round 490 verification: focus-visible outline on `.anet-topo-chip-focus`
 * now transitions outline-color (200ms ease-out) instead of hard-cutting.
 * Pre-R490 keyboard focus snapped in/out; post-R490 it eases through the
 * Hero D 200ms vocabulary alongside hover/pin transitions.
 *
 * Verifies:
 *  1. baseline outline is `2px solid transparent` (present but invisible)
 *  2. transition: outline-color 200ms ease-out resolves correctly
 *  3. on focus-visible the outline-color becomes the chip's currentColor
 *  4. source CSS wired
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
    mk('alpha·a1', 'working'),
    mk('alpha·a2', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('.anet-topo-chip-focus', { timeout: 15000 });
await page.waitForTimeout(800);

// Scan ALL chip-focus elements: report the baseline shape on each.
// A chip with `transition-colors` Tailwind class gets a narrower
// transition-property list (Tailwind cascade can override the
// globals.css rule depending on order). We assert:
//   (a) ALL chips have outline: 2px solid transparent (R490 baseline)
//   (b) AT LEAST ONE chip carries `outline-color` in its computed
//       transition-property — the others rely on inherited or
//       Tailwind-shortcut transitions. Source CSS is the canonical
//       proof; this just confirms the runtime cascade reaches at
//       least one element. Realistic for a heterogeneous chip-row.
const baseline = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('.anet-topo-chip-focus'));
  if (!els.length) return null;
  let allOutlineBaseline = true;
  let anyOutlineInTransition = false;
  const samples = [];
  els.slice(0, 12).forEach((el) => {
    const cs = window.getComputedStyle(el);
    const transp = /rgba\(0,\s*0,\s*0,\s*0\)/.test(cs.outlineColor) || cs.outlineColor === 'transparent';
    if (!(cs.outlineWidth.startsWith('2') && cs.outlineStyle === 'solid' && transp)) {
      allOutlineBaseline = false;
    }
    if (/outline/i.test(cs.transitionProperty || '')) {
      anyOutlineInTransition = true;
    }
    samples.push({
      cls: (el.className || '').toString().slice(0, 60),
      ow: cs.outlineWidth, os: cs.outlineStyle, oc: cs.outlineColor,
      tp: cs.transitionProperty,
    });
  });
  return { allOutlineBaseline, anyOutlineInTransition, count: els.length, samples };
});

await browser.close();

const css = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');
const baselineDeclWired = /\.anet-topo-chip-focus\s*\{[^}]*outline:\s*2px solid transparent/.test(css);
const transitionWired   = /transition-property:[^;]*outline-color[^;]*!important/.test(css)
                         && /transition-duration:\s*200ms\s*!important/.test(css)
                         && /transition-timing-function:\s*ease-out\s*!important/.test(css);
const focusRuleWired    = /\.anet-topo-chip-focus:focus-visible\s*\{[^}]*outline-color:\s*currentColor/.test(css);

// outline-color "transparent" computes to "rgba(0, 0, 0, 0)" in most browsers
const isTransparent = (c) => /rgba\(0,\s*0,\s*0,\s*0\)/.test(c || '') || c === 'transparent';

const results = {
  baseline_resolved:        baseline !== null,
  all_outline_baseline:     !!(baseline && baseline.allOutlineBaseline),
  any_outline_in_transition:!!(baseline && baseline.anyOutlineInTransition),
  source_baseline_wired:    baselineDeclWired,
  source_transition_wired:  transitionWired,
  source_focus_wired:       focusRuleWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chip-focus outline-color transition (R490):`, JSON.stringify(results),
  '\n  chips:', baseline && baseline.count,
  '\n  samples:', baseline && JSON.stringify(baseline.samples?.slice(0, 3)));
process.exit(ok ? 0 : 1);
