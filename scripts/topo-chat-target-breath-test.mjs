/* Round 120 verification: chat-target ring breathes when chat is
 * open. R51 added the static ring at radius+14; R120 adds a SMIL
 * opacity pulse (±0.1, 3s) so the active chat session reads as
 * "live" without being intrusive. Gated by reducedMotion.
 *
 * Drive chatAlias by clicking a node to open the popover. Verify:
 *   - chat-target ring renders with data-chat-target-breath="on"
 *   - the ring has an <animate> child with dur="3s"
 *   - reducedMotion suppresses the breath
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const probe = async (reducedMotion) => {
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1500 },
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-topo-layout', 'ring');
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
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
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 2, { timeout: 30000 });
  await page.waitForTimeout(400);

  // Open chat by clicking the alpha node.
  await page.locator('g[data-node="alpha"]').click();
  await page.waitForTimeout(500);

  const data = await page.evaluate(() => {
    const ring = document.querySelector('[data-chat-target-ring]');
    const anim = ring?.querySelector('animate');
    return {
      ringPresent: !!ring,
      breathAttr:  ring?.getAttribute('data-chat-target-breath') || '',
      hasAnimate:  !!anim,
      dur:         anim?.getAttribute('dur') || null,
    };
  });
  await ctx.close();
  return data;
};

const normal  = await probe(false);
const reduced = await probe(true);
await browser.close();

const results = {
  normal_ringPresent:   normal.ringPresent === true,
  normal_breathOn:      normal.breathAttr === 'on',
  normal_hasAnimate:    normal.hasAnimate === true,
  normal_dur3s:         normal.dur === '3s',
  reduced_ringPresent:  reduced.ringPresent === true,
  reduced_breathOff:    reduced.breathAttr === 'off',
  reduced_noAnimate:    reduced.hasAnimate === false,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chat-target breath:`, JSON.stringify(results),
  `\n  normal=`,  normal,
  `\n  reduced=`, reduced);
process.exit(ok ? 0 : 1);
