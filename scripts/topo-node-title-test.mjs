/* Round 98 verification: node <title> tooltips now include status,
 * group membership (when applicable), and per-node flow counts
 * (inbound/outbound) alongside the existing identity/cwd/last-seen
 * lines. Same info-density spirit as R97 pill tooltips — hover any
 * node and the answer is right there.
 *
 * Fleet:
 *   - alpha1 (working, claude) + alpha2 (idle, claude) → alpha group of 2
 *   - solo (working, gpt-5) — no group (singleton)
 *   - off1 (offline, claude) — has last_seen_at older
 *
 * Flows:
 *   alpha1 → solo × 3
 *   solo → alpha1 × 1
 *   ⇒ alpha1: 1 in / 3 out; solo: 3 in / 1 out; alpha2/off1: no flows
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status, model, ts) => ({
    alias, status, model, runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: ts, updated_at: ts, last_seen_at: ts,
  });
  const sessions = [
    mk('alpha1', 'working', 'claude-opus-4', fresh),
    mk('alpha2', 'idle',    'claude-opus-4', fresh),
    mk('solo',   'working', 'gpt-5',         fresh),
    mk('off1',   'offline', 'claude-opus-4', stale),
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});

const now = Date.now();
const mkMsg = (id, from_alias, to_alias, ageMs) => ({
  id, from_alias, to_alias, content: 'hi', network_id: 'default',
  created_at: new Date(now - ageMs).toISOString(),
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
  mkMsg('m1', 'alpha1', 'solo', 30 * 1000),
  mkMsg('m2', 'alpha1', 'solo', 60 * 1000),
  mkMsg('m3', 'alpha1', 'solo', 90 * 1000),
  mkMsg('m4', 'solo', 'alpha1', 45 * 1000),
] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForTimeout(400);

const titles = await page.evaluate(() => {
  const out = {};
  for (const alias of ['alpha1', 'alpha2', 'solo', 'off1']) {
    const g = document.querySelector(`g[data-node="${alias}"]`);
    out[alias] = g?.querySelector('title')?.textContent || '';
  }
  return out;
});

await browser.close();

const results = {
  // Status line is the heading.
  alpha1_statusHeading:  /^alpha1 · working/m.test(titles.alpha1),
  alpha2_statusHeading:  /^alpha2 · idle/m.test(titles.alpha2),
  solo_statusHeading:    /^solo · working/m.test(titles.solo),
  off1_statusHeading:    /^off1 · offline/m.test(titles.off1),
  // Group line only on multi-member band.
  alpha1_groupShown:     /group: alpha · 2/.test(titles.alpha1),
  alpha2_groupShown:     /group: alpha · 2/.test(titles.alpha2),
  solo_groupSkipped:    !/group:/.test(titles.solo),
  // Flow counts on participating nodes only.
  alpha1_flowsCorrect:   /flows: 1 in \/ 3 out/.test(titles.alpha1),
  solo_flowsCorrect:     /flows: 3 in \/ 1 out/.test(titles.solo),
  alpha2_noFlows:       !/flows:/.test(titles.alpha2),
  off1_lastSeen:         /last seen:/.test(titles.off1),
  // Identity line still present.
  alpha1_hasIdentity:    /claude/i.test(titles.alpha1),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} node titles:`, JSON.stringify(results),
  `\n  alpha1:\n${titles.alpha1}`,
  `\n  alpha2:\n${titles.alpha2}`,
  `\n  solo:\n${titles.solo}`,
  `\n  off1:\n${titles.off1}`);
process.exit(ok ? 0 : 1);
