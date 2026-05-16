/* Round 305 verification: node alias text picks up pin-signature
 * letterSpacing (0.5px) when chatAlias === session.alias. Extends
 * the R219 pin-signature family (recent-row text + legend-row text
 * + edge badge) to the per-node alias label.
 *
 * Test gates: with no chat open, alias should have data-node-alias-
 * chat-target='false'. We cannot easily simulate chat-open without
 * triggering a click + side-effects; this round's primary contract
 * is that the data attribute exists, the transition list includes
 * letter-spacing, and the default (non-chat) state is 0px.
 *
 * Contract:
 *   - All [data-node-alias-text] have data-node-alias-chat-target.
 *   - Default state attribute is 'false'.
 *   - computed transition includes letter-spacing at 0.2s.
 *   - All node alias texts have computed letter-spacing 0px in the
 *     default state.
 *   - R304 sub-hint ls=0.15 + R302 main hint ls=0.2 + R301 panel
 *     titles ls=0.3 + R294 pulse absent intact.
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
  const mk = (alias, model) => ({
    alias, status: 'working', model, runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4'),
    mk('beta',  'gpt-4o'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-node-alias-text]', { timeout: 15000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const aliases = [...document.querySelectorAll('[data-node-alias-text]')];
  const samples = aliases.map(a => ({
    alias:        a.getAttribute('data-node-alias-text'),
    chatTarget:   a.getAttribute('data-node-alias-chat-target'),
    transition:   getComputedStyle(a).transition,
    letterSpacing: getComputedStyle(a).letterSpacing,
  }));
  const subhint = document.querySelector('[data-recent-signal-empty-hint]');
  const empty   = document.querySelector('[data-recent-signal-empty]');
  const recentTitle = document.querySelector('[data-recent-panel-title]');
  const legendTitle = document.querySelector('[data-legend-panel-title]');
  return {
    samples,
    subhintLs:       subhint?.getAttribute('letter-spacing') ?? null,
    emptyLs:         empty?.getAttribute('letter-spacing') ?? null,
    recentTitleLs:   recentTitle?.getAttribute('letter-spacing') ?? null,
    legendTitleLs:   legendTitle?.getAttribute('letter-spacing') ?? null,
    pulseCount:      document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const hasLsTransition = (s) => /letter-spacing\s+0\.?\d*s|letter-spacing\s+\d+ms/i.test(s || '');

const results = {
  alias_texts_present:     probe.samples.length >= 2,
  all_have_chat_target_attr: probe.samples.every(s => s.chatTarget === 'true' || s.chatTarget === 'false'),
  all_default_not_chat:    probe.samples.every(s => s.chatTarget === 'false'),
  all_transition_has_ls:   probe.samples.every(s => hasLsTransition(s.transition)),
  all_default_ls_0:        probe.samples.every(s => parseFloat(s.letterSpacing || '0') === 0 || s.letterSpacing === 'normal' || s.letterSpacing === '0px'),
  r304_subhint_ls:         probe.subhintLs === '0.15',
  r302_empty_main_ls:      probe.emptyLs === '0.2',
  r301_panel_titles_ls:    probe.recentTitleLs === '0.3' && probe.legendTitleLs === '0.3',
  r294_pulse_absent:       probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} node alias chat-pin signature:`, JSON.stringify(results),
  '\n  alias samples:', probe.samples.slice(0, 2),
  '\n  R304 sub-hint ls:', probe.subhintLs,
  '\n  R302 main hint ls:', probe.emptyLs);
process.exit(ok ? 0 : 1);
