/* Round 283 verification: vendor monogram circle strokeWidth bumps
 * 1 → 1.5 per Vincent 5216 "vendor avatar quality" ask increment.
 *
 * Pre-R283: monogram circle (known vendor, no logo asset) rendered
 * with strokeWidth="1". The prefix-group fallback (unknown vendor)
 * also uses strokeWidth="1".
 *
 * Post-R283: monogram (known vendor) bumps to strokeWidth="1.5";
 * prefix-group fallback stays at 1 (less weight = "we don't know
 * what this is" signal preserved).
 *
 * Test trap encountered first draft: each g[data-node] contains
 * THREE small (<r=18) circles —
 *   1. avatar/monogram (r=10-14): strokeWidth 1 or 1.5 per vendor
 *   2. runtime badge   (r=5.5-7): strokeWidth ALWAYS 1.5
 *   3. pulse dot       (r=2.5):   no stroke (null)
 * To isolate the avatar circle, filter by:
 *   - r is the largest of the small circles (avatar) OR
 *   - exclude elements with [data-runtime-badge] attribute
 * We use the data-attr filter — cleaner intent.
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
  // Mix: known vendors (Anthropic + OpenAI monogram) + unknown vendor
  // (no model field).
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4'),    // Anthropic, monogram
    mk('beta',  'gpt-4o'),            // OpenAI, monogram
    mk('gamma', null),                 // unknown, prefix-group fallback
    mk('delta', null),                 // unknown
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-topo-brand-watermark]', { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  // For each node, find the AVATAR circle specifically:
  //   - r < 18 (excludes status ring with r ~22-26)
  //   - NOT a runtime badge (no data-runtime-badge attr)
  //   - has stroke (excludes pulse dot)
  const nodes = [...document.querySelectorAll('g[data-node]')];
  const samples = nodes.map((g) => {
    const alias = g.getAttribute('data-node');
    const circles = [...g.querySelectorAll('circle')];
    const avatar = circles
      .map((c) => ({
        r:        +c.getAttribute('r') || 0,
        sw:       c.getAttribute('stroke-width'),
        stroke:   c.getAttribute('stroke'),
        isBadge:  c.hasAttribute('data-runtime-badge'),
      }))
      .filter((c) => c.r > 0 && c.r < 18 && !c.isBadge && c.stroke && c.stroke !== 'none');
    // Of the remaining, the avatar/monogram is the largest-r one.
    avatar.sort((a, b) => b.r - a.r);
    return { alias, avatarStroke: avatar[0]?.sw ?? null, avatarR: avatar[0]?.r ?? null };
  });
  const watermark = document.querySelector('[data-topo-brand-watermark]');
  return { samples, watermarkPresent: watermark !== null };
});
await browser.close();

const alphaSample = probe.samples.find(s => s.alias === 'alpha');
const betaSample  = probe.samples.find(s => s.alias === 'beta');
const gammaSample = probe.samples.find(s => s.alias === 'gamma');

const results = {
  alpha_anthropic_mono_1_5: alphaSample?.avatarStroke === '1.5',
  beta_openai_mono_1_5:     betaSample?.avatarStroke === '1.5',
  gamma_prefix_stays_1:     gammaSample?.avatarStroke === '1',
  r282_watermark_present:   probe.watermarkPresent,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} monogram stroke:`, JSON.stringify(results),
  '\n  alpha (claude):  stroke=', alphaSample?.avatarStroke, ' r=', alphaSample?.avatarR,
  '\n  beta  (gpt-4o):  stroke=', betaSample?.avatarStroke,  ' r=', betaSample?.avatarR,
  '\n  gamma (unknown): stroke=', gammaSample?.avatarStroke, ' r=', gammaSample?.avatarR);
process.exit(ok ? 0 : 1);
