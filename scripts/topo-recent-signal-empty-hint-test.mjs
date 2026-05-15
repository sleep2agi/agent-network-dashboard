/* Round 110 verification: recent-signal empty placeholder gains a
 * sub-text hint so the empty state reads as intentional invitation
 * rather than a stuck-loading state. Primary line "no flow yet"
 * stays at the same position semantics (now y=54 instead of y=60
 * to balance the two-line stack within the panel); sub-line at
 * y=68 says "send a message between agents".
 *
 * Verifies:
 *   - both lines render when flowLinks is empty
 *   - both lines disappear when flowLinks has content
 *   - data-recent-signal-empty + data-recent-signal-empty-hint
 *     attributes are stable test hooks
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const fresh = new Date(Date.now() - 30 * 1000).toISOString();

const probe = async (withFlow) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
  });
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const mk = (alias) => ({
      alias, status: 'idle', model: 'claude-opus-4', runtime: 'cli-claude-code',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta')] } });
  });
  const now = Date.now();
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: withFlow ? [
    { id: 'm1', from_alias: 'alpha', to_alias: 'beta', content: 'hi',
      network_id: 'default', created_at: new Date(now - 10000).toISOString() },
  ] : [] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 2, { timeout: 30000 });
  await page.waitForTimeout(600);
  const data = await page.evaluate(() => ({
    empty:     document.querySelector('[data-recent-signal-empty]')?.textContent || null,
    emptyHint: document.querySelector('[data-recent-signal-empty-hint]')?.textContent || null,
    rowCount:  document.querySelectorAll('[data-recent-row]').length,
  }));
  await ctx.close();
  return data;
};

const empty = await probe(false);
const full  = await probe(true);
await browser.close();

const results = {
  empty_primaryLineShown:  empty.empty === 'no flow yet',
  empty_hintShown:         /^send a message between agents$/.test(empty.emptyHint || ''),
  empty_noRows:            empty.rowCount === 0,
  full_primaryGone:        full.empty === null,
  full_hintGone:           full.emptyHint === null,
  full_rowsRendered:       full.rowCount >= 1,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-signal empty hint:`, JSON.stringify(results),
  `\n  empty=`, empty,
  `\n  full=`,  full);
process.exit(ok ? 0 : 1);
