/* Round 491 verification: SVG-side focus outline on `.anet-topo-svg-focus`
 * (R156 class, applied to SVG g elements for recent-signal rows, legend
 * rows, group labels, edge badges, nodes, "+N more" footer) now eases
 * outline-color through 200ms ease-out instead of hard-cutting.
 *
 * Sibling polish to R490 (HTML chip-focus). Together: every keyboard-
 * focus surface on the TopoGraph canvas — HTML chips + SVG g — fades
 * smoothly.
 *
 * Verifies:
 *  1. baseline outline: 2px solid transparent on every .anet-topo-svg-focus
 *  2. outline-color in computed transition-property
 *  3. transition-duration === 200ms
 *  4. source CSS rule wired
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
    mk('beta·b1',  'working'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('.anet-topo-svg-focus', { timeout: 15000 });
await page.waitForTimeout(1500);

// Scan ALL .anet-topo-svg-focus elements
const baseline = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('.anet-topo-svg-focus'));
  if (!els.length) return null;
  let allOutlineBaseline = true;
  let allOutlineInTransition = true;
  let allDuration200 = true;
  const samples = [];
  els.slice(0, 10).forEach((el) => {
    const cs = window.getComputedStyle(el);
    const transp = /rgba\(0,\s*0,\s*0,\s*0\)/.test(cs.outlineColor) || cs.outlineColor === 'transparent';
    if (!(cs.outlineWidth.startsWith('2') && cs.outlineStyle === 'solid' && transp)) {
      allOutlineBaseline = false;
    }
    if (!/outline/i.test(cs.transitionProperty || '')) {
      allOutlineInTransition = false;
    }
    if (!/\b0\.2s\b/.test(cs.transitionDuration || '')) {
      allDuration200 = false;
    }
    samples.push({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '-',
      ow: cs.outlineWidth, os: cs.outlineStyle, oc: cs.outlineColor,
      tp: cs.transitionProperty, td: cs.transitionDuration,
    });
  });
  return { allOutlineBaseline, allOutlineInTransition, allDuration200, count: els.length, samples };
});

await browser.close();

const css = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');
const baselineWired   = /\.anet-topo-svg-focus\s*\{[^}]*outline:\s*2px solid transparent/.test(css);
const transitionWired = /\.anet-topo-svg-focus\s*\{[^}]*transition-property:\s*outline-color\s*!important/.test(css);
const focusWired      = /\.anet-topo-svg-focus:focus-visible\s*\{[^}]*outline-color:\s*#67e8f9/.test(css);

const results = {
  baseline_resolved:        baseline !== null,
  any_elements_found:       !!(baseline && baseline.count > 0),
  all_outline_baseline:     !!(baseline && baseline.allOutlineBaseline),
  all_outline_in_transition:!!(baseline && baseline.allOutlineInTransition),
  all_duration_200ms:       !!(baseline && baseline.allDuration200),
  source_baseline_wired:    baselineWired,
  source_transition_wired:  transitionWired,
  source_focus_wired:       focusWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} svg-focus outline-color transition (R491):`, JSON.stringify(results),
  '\n  count:', baseline && baseline.count,
  '\n  sample[0]:', baseline && JSON.stringify(baseline.samples?.[0]));
process.exit(ok ? 0 : 1);
