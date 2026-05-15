/* Round 102 verification: pressure-bar segment tooltips list the
 * aliases that fall into that status bucket. Closes the last "how
 * many but not which" gap in the chip-row surfaces. Composes with
 * the existing R83 hover preview (canvas dims still answer it
 * visually too) — this adds a screen-reader-friendly textual
 * channel for the same info.
 *
 * Fleet: 2 working + 2 idle + 1 offline. Verify each segment's
 * title contains the matching aliases + action hint; data-pressure-
 * seg-aliases attr carries the full CSV.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    sessionStorage.removeItem('anet-topo-pinned-status');
  } catch {}
});

const fresh   = new Date(Date.now() - 60 * 1000).toISOString();
const stale10 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status, ts) => ({
    alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: ts, updated_at: ts, last_seen_at: ts,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('wkr1', 'working', fresh),
    mk('wkr2', 'working', fresh),
    mk('idl1', 'idle',    fresh),
    mk('idl2', 'idle',    fresh),
    mk('off1', 'offline', stale10),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 5, { timeout: 30000 });
await page.waitForTimeout(400);

const read = (key) => page.evaluate((k) => {
  const el = document.querySelector(`[data-pressure-seg="${k}"]`);
  if (!el) return null;
  return {
    title:   el.getAttribute('title') || '',
    aliases: el.getAttribute('data-pressure-seg-aliases') || '',
  };
}, key);

const working = await read('working');
const idle    = await read('idle');
const offline = await read('offline');

// Pin working — action hint should flip in the title.
await page.locator('[data-pressure-seg="working"]').click();
await page.waitForTimeout(250);
const workingPinned = await read('working');

await browser.close();

const sameSet = (csv, expected) => {
  const got = new Set(csv.split(',').filter(Boolean));
  const exp = new Set(expected);
  return got.size === exp.size && [...exp].every(x => got.has(x));
};

const results = {
  working_aliasesMatch:   sameSet(working?.aliases || '', ['wkr1', 'wkr2']),
  working_titleListsThem: /wkr1.*wkr2|wkr2.*wkr1/.test(working?.title || ''),
  working_titleClickHint: /click to highlight/.test(working?.title || ''),
  working_titleStatusN:   /^2 working/m.test(working?.title || ''),
  idle_aliasesMatch:      sameSet(idle?.aliases || '', ['idl1', 'idl2']),
  idle_titleListsThem:    /idl1.*idl2|idl2.*idl1/.test(idle?.title || ''),
  offline_aliasesMatch:   sameSet(offline?.aliases || '', ['off1']),
  offline_titleListsThem: /off1/.test(offline?.title || ''),
  workingPin_aliasesStable: sameSet(workingPinned?.aliases || '', ['wkr1', 'wkr2']),
  workingPin_hintFlipped:   /click to release filter/.test(workingPinned?.title || ''),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} pressure-seg tooltip:`, JSON.stringify(results),
  `\n  working:`,        working,
  `\n  idle:`,           idle,
  `\n  offline:`,        offline,
  `\n  workingPinned:`,  workingPinned);
process.exit(ok ? 0 : 1);
