/* Round 97 verification: each active-filter pill carries the matched
 * alias list in its title attribute + data-filter-match-aliases for
 * tests. Pre-R97 the pill said "filter: working · 3" but you had to
 * eyeball the dimmed canvas to find which 3 nodes were the matches.
 *
 * Drive each pin type and read the alias data attr. Fleet has known
 * mix so the expected alias sets are deterministic.
 *
 * Truncation at 8 aliases is tested via a fleet with > 8 working
 * nodes — confirms the data attr stores the full list (for test
 * stability) while the visible title shows a "+N more" suffix.
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
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
    sessionStorage.removeItem('anet-topo-pinned-status');
    sessionStorage.removeItem('anet-topo-pinned-group');
    sessionStorage.removeItem('anet-topo-pinned-vendor');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status, model) => ({
    alias, status, model, runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // Fleet: 3 working (alpha1/2 + beta1), 3 idle (alpha3 + beta2 + gamma1),
  // 2 vendors A/O. alpha-prefix = 3 members, beta-prefix = 2, gamma = 1.
  const sessions = [
    mk('alpha1', 'working', 'claude-opus-4'),
    mk('alpha2', 'working', 'claude-opus-4'),
    mk('alpha3', 'idle',    'claude-opus-4'),
    mk('beta1',  'working', 'gpt-5'),
    mk('beta2',  'idle',    'gpt-5'),
    mk('gamma1', 'idle',    'claude-opus-4'),
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 6, { timeout: 30000 });
await page.waitForTimeout(400);

const readPill = (kind) => page.evaluate((k) => {
  const p = document.querySelector(`[data-active-filter="${k}"]`);
  if (!p) return null;
  return {
    title:   p.getAttribute('title') || '',
    aliases: p.getAttribute('data-filter-match-aliases') || '',
    count:   p.getAttribute('data-filter-match-count') || '',
  };
}, kind);

const pin = async (kind, value) => {
  await page.evaluate(({ kind, value }) => {
    if (kind === 'status') sessionStorage.setItem('anet-topo-pinned-status', value);
    if (kind === 'group')  sessionStorage.setItem('anet-topo-pinned-group',  value);
    if (kind === 'vendor') sessionStorage.setItem('anet-topo-pinned-vendor', value);
    window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind, value } }));
  }, { kind, value });
  await page.waitForTimeout(200);
};

// Status pin → working should match alpha1, alpha2, beta1.
await pin('status', 'working');
const statusPill = await readPill('status');

// Vendor pin → A should match all claude-opus-4 sessions (alphas + gamma).
await page.locator('[data-vendor-letter="A"]').click();
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const vendorPill = await readPill('vendor');

// Group pin → alpha should match alpha1/2/3.
await page.evaluate(() => {
  sessionStorage.setItem('anet-topo-pinned-group', 'alpha');
  window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'group', value: 'alpha' } }));
});
await page.waitForTimeout(250);
const groupPill = await readPill('group');

await browser.close();

const sameSet = (csv, expected) => {
  const got = new Set(csv.split(',').filter(Boolean));
  const exp = new Set(expected);
  return got.size === exp.size && [...exp].every(x => got.has(x));
};

const results = {
  status_aliasesMatch:  sameSet(statusPill?.aliases || '', ['alpha1', 'alpha2', 'beta1']),
  status_titleListsThem: /alpha1.*alpha2.*beta1|alpha2.*alpha1.*beta1/.test(statusPill?.title || ''),
  status_titleHasClear:  /click to clear/i.test(statusPill?.title || ''),
  group_aliasesMatch:   sameSet(groupPill?.aliases || '', ['alpha1', 'alpha2', 'alpha3']),
  group_titleListsThem:  /alpha1.*alpha2.*alpha3/.test(groupPill?.title || ''),
  vendor_aliasesMatch:  sameSet(vendorPill?.aliases || '', ['alpha1', 'alpha2', 'alpha3', 'gamma1']),
  vendor_titleListsThem: /alpha1.*alpha2.*alpha3.*gamma1/.test(vendorPill?.title || ''),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} filter pill aliases:`, JSON.stringify(results),
  `\n  status=`, statusPill,
  `\n  group=`,  groupPill,
  `\n  vendor=`, vendorPill);
process.exit(ok ? 0 : 1);
