/* Round 103 verification: flow-particle `<animateMotion begin>` is
 * unique per edge, staggered by `-(index × 0.37) % duration s`. Pre-
 * R103 all edges' particles fired at t=0 in lockstep; the stagger
 * gives the canvas an organic "many independent rivers" feel.
 *
 * Verifies:
 *   - every edge has a `begin` attribute on its <animateMotion>
 *   - all begin values are distinct (no two edges share a phase)
 *   - the format is "-Ns" (negative offset for retroactive cycle start)
 *   - reducedMotion still suppresses the particle entirely
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const fresh = new Date(Date.now() - 30 * 1000).toISOString();

const probe = async (reducedMotion) => {
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1500 },
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
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
    await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta'), mk('gamma'), mk('delta'), mk('epsilon')] } });
  });
  const now = Date.now();
  const mkMsg = (id, from_alias, to_alias, ageMs) => ({
    id, from_alias, to_alias, content: 'hi', network_id: 'default',
    created_at: new Date(now - ageMs).toISOString(),
  });
  // Five distinct edges → five animations.
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
    mkMsg('m1', 'alpha', 'beta',   30 * 1000),
    mkMsg('m2', 'gamma', 'delta',  35 * 1000),
    mkMsg('m3', 'beta',  'gamma',  40 * 1000),
    mkMsg('m4', 'delta', 'epsilon', 45 * 1000),
    mkMsg('m5', 'epsilon', 'alpha', 50 * 1000),
  ] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 5, { timeout: 30000 });
  await page.waitForTimeout(400);

  const beginValues = await page.evaluate(() => {
    return [...document.querySelectorAll('animateMotion')]
      .map(a => a.getAttribute('begin'));
  });
  await ctx.close();
  return beginValues;
};

const normal = await probe(false);
const reduced = await probe(true);
await browser.close();

const results = {
  normal_hasAtLeast5: normal.length >= 5,
  normal_allHaveBegin: normal.every(b => typeof b === 'string' && b.length > 0),
  normal_allNegativeOffset: normal.every(b => /^-\d/.test(b || '')),
  normal_allDistinct: new Set(normal).size === normal.length,
  normal_firstIsZero: normal[0] === '-0.000s',
  reduced_noParticles: reduced.length === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} particle stagger:`, JSON.stringify(results),
  `\n  normal=`,  normal,
  `\n  reduced=`, reduced);
process.exit(ok ? 0 : 1);
