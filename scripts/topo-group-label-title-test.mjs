/* Round 99 verification: group label <title> tooltip lists members
 * + status breakdown. Same R97/R98 pattern — anywhere the UI shows
 * "alpha · 3" should hover-explain WHICH 3.
 *
 * Fleet: alpha group has 3 members (2 working + 1 idle), beta has
 * 2 idle. Pin alpha to confirm the title's last line flips from
 * "click to pin" → "click to release pin".
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
    sessionStorage.removeItem('anet-topo-pinned-group');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha1', 'working'),
    mk('alpha2', 'working'),
    mk('alpha3', 'idle'),
    mk('beta1',  'idle'),
    mk('beta2',  'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('[data-group-label-hit]').length >= 2, { timeout: 30000 });
await page.waitForTimeout(400);

const readTitle = (groupKey) => page.evaluate((k) => {
  const g = document.querySelector(`[data-group-label-hit="${k}"]`);
  return g?.querySelector('title')?.textContent || '';
}, groupKey);

const alphaTitle = await readTitle('alpha');
const betaTitle  = await readTitle('beta');

// Pin alpha — last line should flip.
await page.locator('[data-group-label-hit="alpha"]').click();
await page.waitForTimeout(250);
const alphaTitlePinned = await readTitle('alpha');

await browser.close();

const results = {
  alpha_heading:           /^alpha \(3 members\)/m.test(alphaTitle),
  alpha_statusSummary:     /2 working · 1 idle/.test(alphaTitle),
  alpha_listsMembers:      /alpha1.*alpha2.*alpha3/.test(alphaTitle),
  alpha_pinHint:           /click to pin this group/.test(alphaTitle),
  beta_heading:            /^beta \(2 members\)/m.test(betaTitle),
  beta_statusSummary:      /2 idle/.test(betaTitle),
  beta_noWorkingInSummary: !/working/.test(betaTitle),
  beta_listsMembers:       /beta1.*beta2/.test(betaTitle),
  pinned_hintFlipped:      /click to release pin/.test(alphaTitlePinned),
  pinned_keepsMembers:     /alpha1.*alpha2.*alpha3/.test(alphaTitlePinned),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group-label title:`, JSON.stringify(results),
  `\n  alpha:\n${alphaTitle}`,
  `\n  beta:\n${betaTitle}`,
  `\n  alphaPinned:\n${alphaTitlePinned}`);
process.exit(ok ? 0 : 1);
