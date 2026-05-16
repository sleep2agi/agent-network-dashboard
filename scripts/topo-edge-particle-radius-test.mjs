/* Round 422 verification: edge flow particle radius 4 → 4.5.
 * Visual-weight bump family 15th anchor — particles riding along
 * edge animateMotion paths get +0.5px lift (~27% area increase).
 *
 * Contract:
 *   - Seed a flow alpha→beta so an edge mounts → particle mounts
 *   - The <circle data-edge-particle> has:
 *     * r attr === '4.5'
 *     * data-edge-particle-radius === '4.5'
 *   - Pre-R422 invariants preserved:
 *     * R251 fill present (pal.flowParticle)
 *     * R252 transition list (fill 200ms + opacity 200ms)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta'), mk('gamma') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({
  json: { messages: [
    { id: 'm1', from_alias: 'alpha', to_alias: 'beta', content: 'ping', created_at: fresh, network_id: 'default' },
  ] },
}));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-edge-particle]', { timeout: 15000 });
await page.waitForTimeout(500);

const probe = await page.evaluate(() => {
  const particle = document.querySelector('[data-edge-particle]');
  if (!particle) return null;
  return {
    rAttr:        particle.getAttribute('r'),
    rData:        particle.getAttribute('data-edge-particle-radius'),
    fill:         particle.getAttribute('fill'),
    fillPresent:  !!particle.getAttribute('fill'),
    styleAttr:    particle.getAttribute('style') || '',
  };
});

await browser.close();

const results = {
  // R422 wire
  r_attr_4_5:                 probe?.rAttr === '4.5',
  r_data_4_5:                 probe?.rData === '4.5',
  // R251 fill invariant
  fill_present:               probe?.fillPresent === true,
  // R252 transition invariant
  transition_fill:            probe?.styleAttr.includes('fill') === true,
  transition_opacity:         probe?.styleAttr.includes('opacity') === true,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge flow particle radius 4 → 4.5:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
