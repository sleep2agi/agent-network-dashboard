/* Round 113 verification: chip-row "N working" + "N online" tooltips
 * list matched aliases. Closes the last hover surfaces in the chip-
 * row that had generic "Hover to highlight" titles. Same R97-R102 /
 * R101 alias-list pattern.
 *
 * Fleet: 2 working (wkr1/2) + 2 idle (idl1/2) + 1 offline (off1).
 *   working chip title contains wkr1, wkr2; data-working-chip-aliases CSV matches
 *   online chip title contains all online aliases (4); data-online-chip-aliases matches
 *   pin state flips the action hint
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

const read = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  return {
    title:   el.getAttribute('title') || '',
    aliases: el.getAttribute('data-working-chip-aliases') || el.getAttribute('data-online-chip-aliases') || '',
  };
}, sel);

const workingBefore = await read('[data-working-chip]');
const onlineBefore  = await read('[data-online-chip]');

// Pin working status — action hint should flip.
await page.evaluate(() => {
  sessionStorage.setItem('anet-topo-pinned-status', 'working');
  window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'status', value: 'working' } }));
});
await page.waitForTimeout(300);
const workingPinned = await read('[data-working-chip]');

await browser.close();

const sameSet = (csv, expected) => {
  const got = new Set(csv.split(',').filter(Boolean));
  const exp = new Set(expected);
  return got.size === exp.size && [...exp].every(x => got.has(x));
};

const results = {
  workingBefore_aliasesMatch:    sameSet(workingBefore?.aliases || '', ['wkr1', 'wkr2']),
  workingBefore_titleListsThem:  /wkr1.*wkr2|wkr2.*wkr1/.test(workingBefore?.title || ''),
  workingBefore_titleClickHint:  /click to pin/.test(workingBefore?.title || ''),
  onlineBefore_aliasesMatch:     sameSet(onlineBefore?.aliases || '', ['wkr1', 'wkr2', 'idl1', 'idl2']),
  onlineBefore_titleListsThem:   /wkr1/.test(onlineBefore?.title || '') && /idl1/.test(onlineBefore?.title || ''),
  pinnedWorking_aliasesStable:   sameSet(workingPinned?.aliases || '', ['wkr1', 'wkr2']),
  pinnedWorking_titleHintFlipped:/pinned, Esc to clear/.test(workingPinned?.title || ''),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} status-chip tooltip:`, JSON.stringify(results),
  `\n  workingBefore=`,  workingBefore,
  `\n  onlineBefore=`,   onlineBefore,
  `\n  workingPinned=`,  workingPinned);
process.exit(ok ? 0 : 1);
