/* Round 29 verification: `f` keyboard shortcut triggers fit-to-content.
 *   - on a fleet that overflows: f sets zoom < 100%
 *   - on a fleet that fits at 100%: f is a recenter (zoom stays/returns 100%)
 *   - input-focus suppression: typing `f` in Cmd+K palette must not fit
 *   - help overlay lists `f` */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function load({ fleetSize, persisted }) {
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
    const groups = ['A站', 'B站', 'C站', 'D站', 'E站', 'F站', 'G站'];
    const aliases = Array.from({ length: fleetSize }, (_, i) =>
      `${groups[Math.floor(i / 5) % groups.length]}n${i + 1}`);
    const sessions = aliases.map(a => ({
      alias: a, status: 'idle', network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    }));
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((n) => document.querySelectorAll('g[data-node]').length === n, fleetSize, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
  return { ctx, page };
}

const readZoom = (page) => page.evaluate(() => {
  const span = document.querySelector('button[aria-label="Zoom in"]').parentElement.querySelector('span[title*="zoom level"]');
  return +span.textContent.replace('%', '');
});

// 1. Big fleet, persisted view at 100% → autoFit doesn't run (persisted respected);
//    user presses `f` and gets fitted now.
const big = await load({ fleetSize: 35, persisted: { zoom: 1, x: 0, y: 0 } });
const bigBefore = await readZoom(big.page);
await big.page.keyboard.press('f');
await big.page.waitForTimeout(150);
const bigAfter = await readZoom(big.page);
await big.ctx.close();

// 2. Small fleet (no overflow), user manually zoomed in via `+` then presses `f` to recenter.
const small = await load({ fleetSize: 6, persisted: { zoom: 1, x: 0, y: 0 } });
await small.page.keyboard.press('=');
await small.page.keyboard.press('=');
await small.page.waitForTimeout(120);
const smallZoomedIn = await readZoom(small.page);
await small.page.keyboard.press('f');
await small.page.waitForTimeout(150);
const smallAfterFit = await readZoom(small.page);
await small.ctx.close();

// 3. Input-focus suppression: open Cmd+K, type `f`, expect no fit.
const focus = await load({ fleetSize: 35, persisted: { zoom: 1, x: 0, y: 0 } });
const focusBefore = await readZoom(focus.page);
await focus.page.keyboard.press('Meta+k');
await focus.page.waitForTimeout(200);
const paletteInput = focus.page.locator('input[placeholder*="Search"], input[type="search"], [role="dialog"] input').first();
await paletteInput.focus().catch(() => {});
await focus.page.keyboard.press('f');
await focus.page.waitForTimeout(150);
const focusAfter = await readZoom(focus.page);
await focus.page.keyboard.press('Escape');
await focus.ctx.close();

// 4. Help overlay lists `f`.
const help = await load({ fleetSize: 4 });
await help.page.keyboard.press('?');
await help.page.waitForTimeout(200);
const helpHasFit = await help.page.evaluate(() => {
  const heading = [...document.querySelectorAll('[role="dialog"] div')].find(el => el.textContent === 'Topology canvas');
  if (!heading) return false;
  const txt = heading.parentElement?.textContent || '';
  return /Fit topology/i.test(txt);
});
await help.ctx.close();

await browser.close();
const results = {
  bigFleetFKeyFits: bigBefore === 100 && bigAfter < 100 && bigAfter >= 50,
  smallFleetFKeyRecenters: smallZoomedIn > 100 && smallAfterFit === 100,
  inputFocusSuppressed: focusAfter === focusBefore,
  helpOverlayListsFit: helpHasFit,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} fit key:`, JSON.stringify(results),
  `bigBefore=${bigBefore} bigAfter=${bigAfter} smallZoomedIn=${smallZoomedIn} smallAfterFit=${smallAfterFit} focusBefore=${focusBefore} focusAfter=${focusAfter}`);
process.exit(ok ? 0 : 1);
