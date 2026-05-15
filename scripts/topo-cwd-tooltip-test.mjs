/* Round 33 verification: hover tooltip carries `cwd: <project_dir>` on a
 * second line when reported; falls back to the identity-only line
 * otherwise; no `cwd:` line for nodes without project_dir. */
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
  const sessions = [
    {
      alias: 'full', status: 'idle', network_id: nid,
      project_dir: '/home/vansin/agent-orchestra',
      model: 'claude-opus-4-7', runtime: 'cli-claude-code',
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    },
    {
      alias: 'cwdOnly', status: 'idle', network_id: nid,
      project_dir: '/home/vansin/some-project',
      model: null, runtime: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    },
    {
      alias: 'bare', status: 'idle', network_id: nid,
      project_dir: null, model: null, runtime: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    },
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForTimeout(400);

const titleOf = alias => page.$eval(`g[data-node="${alias}"] title`, el => el.textContent);
const full = await titleOf('full');
const cwdOnly = await titleOf('cwdOnly');
const bare = await titleOf('bare');

await browser.close();
const results = {
  fullHasIdentityAndCwd: /claude-opus-4-7/.test(full) && /cwd: \/home\/vansin\/agent-orchestra/.test(full) && full.includes('\n'),
  cwdOnlyShowsAliasAndCwd: cwdOnly.startsWith('cwdOnly') && /cwd: \/home\/vansin\/some-project/.test(cwdOnly),
  bareShowsAliasOnly: bare === 'bare',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} cwd tooltip:`, JSON.stringify(results),
  `\n  full=${JSON.stringify(full)}\n  cwdOnly=${JSON.stringify(cwdOnly)}\n  bare=${JSON.stringify(bare)}`);
process.exit(ok ? 0 : 1);
