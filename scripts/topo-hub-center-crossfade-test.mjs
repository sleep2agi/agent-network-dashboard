/* Round 213 verification: hub centre crossfades the workingCount
 * digit and the decorative highlight when count crosses zero,
 * instead of mount/unmount snap.
 *
 * Pre-R213 a fleet going workingCount 0 → 1 swapped highlight
 * circle (R130 decorative) ↔ digit text in a single frame —
 * visible flash at the canvas's focal point. R213 always-mounts
 * both, opacity-gates them, and adds `transition: opacity 300ms
 * ease-out` so they crossfade. Same R181/R182/R183 always-mount
 * pattern applied at the hub-center scope.
 *
 * Test scenarios (cyber dark):
 *   A. 4 working sessions (workingCount=4):
 *      · digit visible (opacity 1), data-...-visible='true'
 *      · highlight hidden (opacity 0), data-...-visible='false'
 *      · BOTH elements present in DOM (always-mount)
 *      · Both have inline transition with 'opacity 300ms'
 *   B. 4 idle sessions (workingCount=0):
 *      · digit hidden (opacity 0), data-...-visible='false'
 *      · highlight visible (opacity 0.9), data-...-visible='true'
 *      · BOTH still in DOM
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function pageFor(allStatus) {
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
      alias, status: allStatus, model: 'claude-opus-4', runtime: 'claude-code-cli',
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
  await page.waitForTimeout(300);
  return page;
}

const probe = async (page) => page.evaluate(() => {
  const digit = document.querySelector('[data-topo-hub-working-count]');
  const high  = document.querySelector('[data-topo-hub-highlight]');
  function px(el) {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      visible:    el.getAttribute(el === document.querySelector('[data-topo-hub-working-count]')
                  ? 'data-topo-hub-working-count-visible'
                  : 'data-topo-hub-highlight-visible'),
      opacity:    parseFloat(cs.opacity),
      transition: el.style.transition,
    };
  }
  return {
    digitPresent: !!digit,
    highlightPresent: !!high,
    digit:     px(digit),
    highlight: px(high),
    digitText: digit?.textContent,
  };
});

// Scenario A: all working → digit visible, highlight hidden
const pageA = await pageFor('working');
const probeA = await probe(pageA);
await pageA.close();

// Scenario B: all idle (workingCount=0) → highlight visible, digit hidden
const pageB = await pageFor('idle');
const probeB = await probe(pageB);
await pageB.close();
await browser.close();

const near = (got, want, tol = 0.05) => Math.abs(got - want) < tol;
const hasOpacityT = (s) => /opacity\s+(?:300ms|0\.3s)/.test(s || '');

const results = {
  // A: working
  A_digit_in_dom:           probeA.digitPresent,
  A_highlight_in_dom:       probeA.highlightPresent,
  A_digit_visible:          probeA.digit?.visible === 'true',
  A_digit_opacity_1:        near(probeA.digit?.opacity ?? 0, 1),
  A_highlight_hidden:       probeA.highlight?.visible === 'false',
  A_highlight_opacity_0:    near(probeA.highlight?.opacity ?? 1, 0),
  A_digit_text_4:           probeA.digitText === '4',

  // B: idle (workingCount=0)
  B_digit_in_dom:           probeB.digitPresent,
  B_highlight_in_dom:       probeB.highlightPresent,
  B_digit_hidden:           probeB.digit?.visible === 'false',
  B_digit_opacity_0:        near(probeB.digit?.opacity ?? 1, 0),
  B_highlight_visible:      probeB.highlight?.visible === 'true',
  B_highlight_opacity_0p9:  near(probeB.highlight?.opacity ?? 0, 0.9),
  B_digit_text_0:           probeB.digitText === '0',

  // Both transitions present
  A_digit_transition:       hasOpacityT(probeA.digit?.transition),
  A_highlight_transition:   hasOpacityT(probeA.highlight?.transition),
  B_digit_transition:       hasOpacityT(probeB.digit?.transition),
  B_highlight_transition:   hasOpacityT(probeB.highlight?.transition),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub-center crossfade:`, JSON.stringify(results),
  `\n  probeA (working=4):`, probeA,
  `\n  probeB (working=0):`, probeB);
process.exit(ok ? 0 : 1);
