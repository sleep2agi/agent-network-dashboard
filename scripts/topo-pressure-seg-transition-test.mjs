/* Round 165 verification: pressure-bar segments smoothly
 * transition their widths.
 *
 * Pre-R165 segment widths snapped instantly when fleet
 * composition shifted (e.g., a node going idle → working).
 * R165 adds `transition: width 220ms ease-out, box-shadow
 * 150ms ease-out` on each <span data-pressure-seg> inline
 * style — smooths the breath, doesn't change semantics.
 *
 * Tests:
 *   1. All segments carry the inline transition declaration
 *   2. Pin one segment → boxShadow string changes (R60 idiom)
 *   3. Width attribute is a percentage of (n/total)*100
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
const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status, last) => ({
    alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: last, updated_at: last, last_seen_at: last,
  });
  // 3 working + 2 idle + 1 offline = 6 total
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a1', 'working', fresh), mk('a2', 'working', fresh), mk('a3', 'working', fresh),
    mk('b1', 'idle',    fresh), mk('b2', 'idle',    fresh),
    mk('c1', 'offline', stale),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 6, { timeout: 30000 });
await page.waitForSelector('[data-pressure-seg]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const segs = ['working', 'idle', 'offline'].map(k => {
    const el = document.querySelector(`[data-pressure-seg="${k}"]`);
    if (!el) return null;
    // Inline style is what we wrote; window.getComputedStyle reports the
    // resolved value (which for `transition` is the long form).
    const inlineTransition = el.style.transition || '';
    const computedTransition = getComputedStyle(el).transition || '';
    return {
      key: k,
      width: el.style.width,
      inlineTransition,
      // Match either width 220ms OR the resolved computed form.
      hasTransitionWidth:
        inlineTransition.includes('width 220ms') ||
        /width\s+0\.22s|width\s+220ms/.test(computedTransition),
      hasTransitionBoxShadow:
        inlineTransition.includes('box-shadow 150ms') ||
        /box-shadow\s+0\.15s|box-shadow\s+150ms/.test(computedTransition),
    };
  });
  return segs;
});

// Pin the idle segment → boxShadow should appear (R60 inset rings)
const boxBeforePin = await page.evaluate(() => {
  const el = document.querySelector('[data-pressure-seg="idle"]');
  return el ? el.style.boxShadow : null;
});
await page.locator('[data-pressure-seg="idle"]').click({ force: true });
await page.waitForTimeout(300);
const boxAfterPin = await page.evaluate(() => {
  const el = document.querySelector('[data-pressure-seg="idle"]');
  return el ? el.style.boxShadow : null;
});

await browser.close();

const allOk = probe.every(p => p && p.hasTransitionWidth && p.hasTransitionBoxShadow);
const results = {
  three_segs_present:           probe.length === 3 && probe.every(p => p !== null),
  all_have_transition_width:    probe.every(p => p?.hasTransitionWidth),
  all_have_transition_boxShadow: probe.every(p => p?.hasTransitionBoxShadow),
  working_width_50:             probe[0]?.width === '50%',   // 3/6
  idle_width_33:                /33\.3|33%/.test(probe[1]?.width || ''),  // 2/6
  offline_width_16:             /16\.6|16%/.test(probe[2]?.width || ''),  // 1/6
  pin_changes_boxShadow:        boxBeforePin === '' && boxAfterPin !== '',
  overall:                      allOk,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} pressure-seg transition:`, JSON.stringify(results),
  `\n  probes=`, probe,
  `\n  box before/after pin =`, JSON.stringify(boxBeforePin), '→', JSON.stringify(boxAfterPin));
process.exit(ok ? 0 : 1);
