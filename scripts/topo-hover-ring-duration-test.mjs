/* Round 489 verification: hover ring (Round 2 outer stroke) transition
 * duration harmonized from 150ms to 200ms, joining the Hero D #147
 * motion-coherence stack as 11th surface.
 *
 * Verifies the DOM rendered circle carries the Tailwind class
 * `duration-200` (and NO `duration-150`), and the computed CSS
 * transition-duration on the element resolves to 200ms.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
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
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·a1', 'working'),
    mk('alpha·a2', 'idle'),
    mk('beta·b1',  'working'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('g[data-node]', { timeout: 15000 });
await page.waitForTimeout(1500);

// Find the hover-ring circle inside the first g[data-node]: it's the
// one with stroke="" (status.primary, varies) + strokeWidth="2" +
// the `transition-opacity duration-200` class (R2 + R489).
const ringInfo = await page.evaluate(() => {
  const g = document.querySelector('g[data-node]');
  if (!g) return null;
  // hover ring is the circle with strokeWidth='2' that uses transition-opacity
  const circles = Array.from(g.querySelectorAll('circle'));
  const ring = circles.find((c) =>
    c.getAttribute('stroke-width') === '2' && /transition-opacity/.test(c.getAttribute('class') || '')
  );
  if (!ring) return { found: false };
  const cls = ring.getAttribute('class') || '';
  const cs = window.getComputedStyle(ring);
  return {
    found: true,
    has_duration_200: /\bduration-200\b/.test(cls),
    has_duration_150: /\bduration-150\b/.test(cls),
    class_attr: cls,
    transition_duration: cs.transitionDuration,
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceDuration200 = /opacity-0 group-hover:opacity-70 transition-opacity duration-200/.test(src);
const sourceNoDuration150 = !/opacity-0 group-hover:opacity-70 transition-opacity duration-150/.test(src);

const results = {
  ring_dom_found:       ringInfo && ringInfo.found,
  ring_has_dur_200:     !!(ringInfo && ringInfo.has_duration_200),
  ring_no_dur_150:      !!(ringInfo && !ringInfo.has_duration_150),
  computed_200ms:       !!(ringInfo && /^0?\.?2(00)?(s|0ms)?$/.test((ringInfo.transition_duration || '').trim()) || (ringInfo && ringInfo.transition_duration === '0.2s')),
  source_dur_200_wired: sourceDuration200,
  source_dur_150_gone:  sourceNoDuration150,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hover-ring duration harmonize (R489):`, JSON.stringify(results),
  '\n  computed:', ringInfo && ringInfo.transition_duration, '/ class:', ringInfo && ringInfo.class_attr);
process.exit(ok ? 0 : 1);
