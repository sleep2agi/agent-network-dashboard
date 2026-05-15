/* Round 203 verification: recent-signal panel rows fade in on mount,
 * not just when the panel itself first appears (R175). Pre-R203 a new
 * flow rising into the top-3 list snap-popped in; R203 attaches
 * anet-fade-in per-row so the entrance eases.
 *
 * Key={link.key} preserves stable identity across re-renders — the
 * animation plays once per mount, not on every count update.
 *
 * Test (cyber dark, 3 flows already present at load):
 *   1. Three recent-signal rows render with data-recent-row.
 *   2. Each row's className includes 'anet-fade-in' AND
 *      'anet-topo-svg-focus' (existing focus class kept).
 *   3. CSS animationName resolves to a non-empty value matching the
 *      anet-fade-in keyframe (we read it via getComputedStyle — the
 *      browser's compiled CSS-rule selector binds the class to the
 *      animation).
 *   4. Existing R143 row-lift inline transition is intact
 *      (transform 150ms cubic-bezier).
 *   5. Existing R160 pip and R191 ts elements still render inside
 *      each row — no markup regression from the className change.
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

const now = Date.now();
const msgs = [
  { id: 'a', from_alias: 'alpha', to_alias: 'beta',  content: 'hi',
    network_id: 'default', created_at: new Date(now - 3000).toISOString() },
  { id: 'b', from_alias: 'beta',  to_alias: 'gamma', content: 'hi',
    network_id: 'default', created_at: new Date(now - 6000).toISOString() },
  { id: 'c', from_alias: 'gamma', to_alias: 'delta', content: 'hi',
    network_id: 'default', created_at: new Date(now - 9000).toISOString() },
];
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-recent-row]', { timeout: 10000 });

// Wait past panel R175 700ms delay + 150ms row animation so the rows
// have finished their entrance and computed style shows the resting
// state with the animation declared in CSS but completed.
await page.waitForTimeout(1100);

const rows = await page.evaluate(() => {
  return [...document.querySelectorAll('[data-recent-row]')].map(el => {
    const cs = getComputedStyle(el);
    const pip = el.querySelector('[data-recent-row-freshness]');
    const ts  = el.querySelector('[data-recent-row-ts]');
    return {
      key:           el.getAttribute('data-recent-row'),
      className:     el.getAttribute('class') || '',
      animationName: cs.animationName,
      animationDuration: cs.animationDuration,
      inlineTransition:  el.style.transition,
      hasFreshnessPip:   !!pip,
      hasTimestamp:      !!ts,
    };
  });
});

await browser.close();

const has = (s, c) => (s || '').split(/\s+/).includes(c);

const results = {
  three_rows_present:           rows.length === 3,
  all_have_fadein_class:        rows.every(r => has(r.className, 'anet-fade-in')),
  all_keep_focus_class:         rows.every(r => has(r.className, 'anet-topo-svg-focus')),
  all_have_animation_bound:     rows.every(r => /anet-fade-in|fadein/i.test(r.animationName)
                                                || r.animationName.includes('anet-fade-in')),
  // R143 row-lift transition still in inline style
  all_keep_transform_transition: rows.every(r => /transform\s+(?:150ms|0\.15s)/.test(r.inlineTransition || '')),
  // R160 R191 markup contracts unbroken
  all_have_pip:                 rows.every(r => r.hasFreshnessPip === true),
  all_have_ts:                  rows.every(r => r.hasTimestamp === true),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row fade-in:`, JSON.stringify(results),
  `\n  rows:`, rows);
process.exit(ok ? 0 : 1);
