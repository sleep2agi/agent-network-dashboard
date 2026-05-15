/* Round 218 verification: group label text gains letter-spacing
 * transition on pin — 0px → 0.5px when group is pinned. Hover and
 * pin share fill colour (R63 legendHeadline) so pre-R218 they
 * looked typographically identical. R218 spreads the pinned text
 * to read "locked in" at the text level.
 *
 * Test (cyber dark, 17 sessions in 2 prefix groups → 'group-A' +
 * 'group-B' groupBoxes after switch to grid layout):
 *   1. Switch to grid layout to trigger groupBoxes rendering.
 *   2. Both group labels render with data-group-label.
 *   3. Idle: data-group-label-pinned='false', computed
 *      letter-spacing ~ 0px.
 *   4. Inline transition includes 'letter-spacing 200ms'.
 *   5. Click one group label → that group becomes pinned.
 *   6. Pinned label: data-group-label-pinned='true', computed
 *      letter-spacing ~ 0.5px.
 *   7. Other (un-pinned) group stays at 0px letter-spacing.
 *   8. Click pinned again → unpin → back to 0px.
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
  // Two prefix groups: 'alpha-*' and 'beta-*' (each ≥2 → forms a group)
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha-1'), mk('alpha-2'), mk('alpha-3'),
    mk('beta-1'),  mk('beta-2'),  mk('beta-3'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 6, { timeout: 30000 });
await page.waitForSelector('[data-topo-chrome-layout="grid"]', { timeout: 10000 });
await page.waitForTimeout(200);

// Switch to grid layout to trigger groupBoxes
await page.click('[data-topo-chrome-layout="grid"]');
await page.waitForTimeout(600);
await page.waitForSelector('[data-group-label]', { timeout: 5000, state: 'attached' });
await page.waitForTimeout(300);

const probe = async () => page.evaluate(() => {
  return [...document.querySelectorAll('[data-group-label]')].map(el => {
    const cs = getComputedStyle(el);
    return {
      key:         el.getAttribute('data-group-label'),
      pinned:      el.getAttribute('data-group-label-pinned'),
      spacing:     cs.letterSpacing,
      transition:  el.style.transition,
    };
  });
});

const idle = await probe();

// Click first group label to pin it. The label hit area is the
// invisible rect — but the <text> itself often gets the click via
// the wrapper <g> with onClick. Find the parent <g role='button'>
// (data-group-label-hit) and click it.
const firstKey = idle[0]?.key;
if (firstKey) {
  await page.click(`[data-group-label-hit="${firstKey}"]`);
  await page.waitForTimeout(260);  // past 200ms transition
}
const pinned = await probe();

// Click again to unpin
if (firstKey) {
  await page.click(`[data-group-label-hit="${firstKey}"]`);
  await page.waitForTimeout(260);
}
const unpinned = await probe();

await browser.close();

// CSS resolves `letterSpacing: '0px'` to the keyword 'normal' in
// computed style — they're equivalent. Accept both forms as "zero
// spacing"; numeric values still parse cleanly via parseFloat.
const near = (s, want, tol = 0.15) => {
  if (want === 0 && (s === 'normal' || s === '0px' || s === '0' || !s)) return true;
  const got = parseFloat(s || '0');
  return Math.abs(got - want) < tol;
};
const hasLetterSpacingT = (s) => /letter-spacing\s+(?:200ms|0\.2s)/.test(s || '');

const firstIdle    = idle[0];
const firstPinned  = pinned.find(p => p.key === firstKey);
const otherIdle    = idle[1];
const otherPinned  = pinned.find(p => p.key !== firstKey);
const firstUnpin   = unpinned.find(p => p.key === firstKey);

const results = {
  two_groups_present:        idle.length >= 2,

  // Idle: all unpinned, spacing 0, transition present
  all_idle_unpinned:         idle.every(p => p.pinned === 'false'),
  all_idle_spacing_zero:     idle.every(p => near(p.spacing, 0)),
  all_have_transition:       idle.every(p => hasLetterSpacingT(p.transition)),

  // First pinned, second still idle
  first_pinned_attr:         firstPinned?.pinned === 'true',
  first_pinned_spacing:      near(firstPinned?.spacing, 0.5),
  other_stays_unpinned:      otherPinned?.pinned === 'false',
  other_spacing_unchanged:   near(otherPinned?.spacing, 0),

  // After unpin: spacing back to 0
  unpinned_attr_false:       firstUnpin?.pinned === 'false',
  unpinned_spacing_zero:     near(firstUnpin?.spacing, 0),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group-label pin spacing:`, JSON.stringify(results),
  `\n  idle:`,     idle,
  `\n  pinned:`,   pinned,
  `\n  unpinned:`, unpinned);
process.exit(ok ? 0 : 1);
