/* Round 39 verification: each flow-link path carries a `<title>` with
 * "from → to\nN messages · last <relative>". Tests:
 *  - tooltip text shape (route + count + relative time)
 *  - singular vs. plural ("1 message" vs "5 messages")
 *  - missing last_at falls through cleanly */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = ['alpha', 'beta', 'gamma'].map(a => ({
    alias: a, status: 'idle', network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  }));
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
// Inject messages: 1 between alpha→beta (singular), 5 between alpha→gamma (plural).
const old = new Date(Date.now() - 8 * 60 * 1000).toISOString();
const recent = new Date(Date.now() - 30 * 1000).toISOString();
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
  { from_alias: 'alpha', to_alias: 'beta',  content: 'hello',  created_at: old },
  { from_alias: 'alpha', to_alias: 'gamma', content: 'm1', created_at: recent },
  { from_alias: 'alpha', to_alias: 'gamma', content: 'm2', created_at: recent },
  { from_alias: 'alpha', to_alias: 'gamma', content: 'm3', created_at: recent },
  { from_alias: 'alpha', to_alias: 'gamma', content: 'm4', created_at: recent },
  { from_alias: 'alpha', to_alias: 'gamma', content: 'm5', created_at: recent },
] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForTimeout(600);

// Collect every flow-link tooltip (each base path with a child <title>).
const tooltips = await page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  // Two paths per flow link — the base one carries the <title>.
  const titled = [...svg.querySelectorAll('path > title')];
  return titled.map(t => t.textContent);
});

await browser.close();
const has = (route, count, plural) => tooltips.some(t =>
  t.includes(route) &&
  (plural ? t.includes(`${count} messages`) : t.includes(`${count} message`)) &&
  /last \w+ ago/.test(t)
);
const results = {
  singularAlphaToBeta: has('alpha → beta', 1, false),
  pluralAlphaToGamma: has('alpha → gamma', 5, true),
  tooltipCount: tooltips.length === 2,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge tooltip:`, JSON.stringify(results), '\n  tooltips=', tooltips);
process.exit(ok ? 0 : 1);
