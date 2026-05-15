/* Round 28 verification: first-paint auto-fit zoom when grid content
 * would overflow viewBox; respects persisted view; doesn't fire on
 * small fleets (no overflow). */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function probe({ fleetSize, persisted }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(([pers]) => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-topo-layout', 'grid');
      if (pers) localStorage.setItem('anet-topo-view', JSON.stringify(pers));
      else localStorage.removeItem('anet-topo-view');
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  }, [persisted]);
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    // Use prefix groups with 5 members each — 7 bands stack vertically
    // and overflow the 680-px viewBox at cellH ≥ 81 (Round 27 floor).
    const aliases = Array.from({ length: fleetSize }, (_, i) => {
      const groups = ['A站', 'B站', 'C站', 'D站', 'E站', 'F站', 'G站', 'H站', 'I站', 'J站'];
      const group = groups[Math.floor(i / 5) % groups.length];
      return `${group}n${i + 1}`;
    });
    const sessions = aliases.map(a => ({
      alias: a, status: 'idle', network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    }));
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((n) => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    return !!svg && svg.querySelectorAll('g[data-node]').length === n;
  }, fleetSize, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  const zoom = await page.evaluate(() => {
    const span = document.querySelector('button[aria-label="Zoom in"]').parentElement.querySelector('span[title*="zoom level"]');
    return +span.textContent.replace('%', '');
  });
  await ctx.close();
  return zoom;
}

// 1. Big fleet (35 nodes / 7 bands → overflows ~680-px viewBox at cellH≥81)
//    with no persisted view → auto-fit triggers (zoom < 100%)
const bigFresh = await probe({ fleetSize: 35 });
// 2. Big fleet, user has persisted view (zoom=1) → respect it, no auto-fit
const bigPersisted = await probe({ fleetSize: 35, persisted: { zoom: 1, x: 0, y: 0 } });
// 3. Small fleet, no persisted view → no overflow, zoom stays 100%
const smallFresh = await probe({ fleetSize: 6 });

await browser.close();
const results = {
  bigFleetAutoFits: bigFresh < 100 && bigFresh >= 50,
  persistedRespected: bigPersisted === 100,
  smallFleetStays100: smallFresh === 100,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} auto-fit:`, JSON.stringify(results),
  `bigFresh=${bigFresh}% bigPersisted=${bigPersisted}% smallFresh=${smallFresh}%`);
process.exit(ok ? 0 : 1);
