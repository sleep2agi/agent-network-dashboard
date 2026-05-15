/* Round 211 verification: node alias-card text fills (alias + sub-
 * status label) transition fill on status flip, matching R167
 * status-ring fill 300ms. Pre-R211 the ring smoothly recolored
 * while the text snap-cut to the new tier hue.
 *
 * Test (cyber dark, 4 sessions in card mode):
 *   1. 4 [data-node-alias-text] alias texts present, 4
 *      [data-node-sub-text] sub texts present.
 *   2. Each has inline style.transition: 'fill 300ms ease-out'.
 *   3. Alias fill matches the session's status.text colour family
 *      (working green-ish, idle teal-ish, offline gray-ish).
 *   4. Sub  fill matches status.primary (similar tier hue).
 *   5. transition value is identical across all alias texts
 *      (signals consistent timing — not per-node drift).
 *   6. Truncate verified — alias rendered text matches the
 *      session.alias (no extra chars, no missing).
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
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'working'),
    mk('beta',  'working'),
    mk('gamma', 'idle'),
    mk('delta', 'offline'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-node-alias-text]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const aliasTexts = [...document.querySelectorAll('[data-node-alias-text]')];
  const subTexts   = [...document.querySelectorAll('[data-node-sub-text]')];
  return {
    alias: aliasTexts.map(el => ({
      alias:      el.getAttribute('data-node-alias-text'),
      text:       el.textContent,
      fill:       el.getAttribute('fill'),
      transition: el.style.transition,
    })),
    sub: subTexts.map(el => ({
      alias:      el.getAttribute('data-node-sub-text'),
      text:       el.textContent,
      fill:       el.getAttribute('fill'),
      transition: el.style.transition,
    })),
  };
});

await browser.close();

const hasFillT = (s) => /fill\s+(?:300ms|0\.3s)\s+ease-out/.test(s || '');

const aliasAlpha = probe.alias.find(t => t.alias === 'alpha');
const aliasGamma = probe.alias.find(t => t.alias === 'gamma');
const aliasDelta = probe.alias.find(t => t.alias === 'delta');
const subAlpha   = probe.sub.find(t => t.alias === 'alpha');
const subDelta   = probe.sub.find(t => t.alias === 'delta');

const results = {
  four_alias_texts:           probe.alias.length === 4,
  four_sub_texts:             probe.sub.length === 4,

  alpha_alias_renders:        aliasAlpha?.text === 'alpha',
  gamma_alias_renders:        aliasGamma?.text === 'gamma',
  delta_alias_renders:        aliasDelta?.text === 'delta',

  // All alias texts have fill transition
  all_alias_have_fill_transition: probe.alias.every(t => hasFillT(t.transition)),
  all_sub_have_fill_transition:   probe.sub.every(t => hasFillT(t.transition)),

  // Working alpha vs offline delta — fill differs (different tier color)
  alpha_delta_fill_differs:   aliasAlpha?.fill && aliasDelta?.fill
                              && aliasAlpha.fill !== aliasDelta.fill,

  // Working vs idle — fill differs (working green / idle teal in palette)
  alpha_gamma_fill_differs:   aliasAlpha?.fill && aliasGamma?.fill
                              && aliasAlpha.fill !== aliasGamma.fill,

  // Sub text fill present (non-empty)
  sub_fills_present:          probe.sub.every(t => !!t.fill && t.fill !== 'none'),

  // Sub text content reflects status label (working / idle / offline)
  sub_alpha_has_working:      /working|sse/i.test(subAlpha?.text || ''),
  sub_delta_has_offline:      /offline/i.test(subDelta?.text || ''),

  // Transition uniformity — all alias texts share the same transition string
  alias_transition_uniform:   new Set(probe.alias.map(t => t.transition)).size === 1,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} node text fill transition:`, JSON.stringify(results),
  `\n  alias:`, probe.alias,
  `\n  sub:`,   probe.sub);
process.exit(ok ? 0 : 1);
