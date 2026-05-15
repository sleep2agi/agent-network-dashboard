/* Round 57 verification: recent-signal + legend panels carry a drop-
 * shadow filter so they read as floating cards instead of pasted-on
 * graphics — especially important on light theme where panel fill is
 * near-white on a near-white canvas.
 *
 *  - Both panels render a <rect> with `data-topo-panel-elevation`.
 *  - The rect's `style.filter` contains "drop-shadow(".
 *  - Light vs cyber themes use different shadow alpha (light tuned for
 *    contrast against white canvas; cyber for subtle depth on dark).
 *    Verify the strings differ so the theme switch isn't a no-op.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function probe(theme) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('anet-theme', t);
      localStorage.setItem('anet-topo-layout', 'ring');
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  }, theme);
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const sessions = ['alpha', 'beta'].map(a => ({
      alias: a, status: 'idle', network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    }));
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('rect[data-topo-panel-elevation="recent"]', { timeout: 30000 });
  await page.waitForTimeout(400);
  const filters = await page.evaluate(() => {
    const recent = document.querySelector('rect[data-topo-panel-elevation="recent"]');
    const legend = document.querySelector('rect[data-topo-panel-elevation="legend"]');
    return {
      recent: recent?.getAttribute('style') || '',
      legend: legend?.getAttribute('style') || '',
      recentComputed: recent ? getComputedStyle(recent).filter : null,
      legendComputed: legend ? getComputedStyle(legend).filter : null,
    };
  });
  await ctx.close();
  return filters;
}

const light = await probe('light');
const cyber = await probe('cyber');
await browser.close();

const hasShadow = (s) => /drop-shadow\(/.test(s || '');
const results = {
  light_recent_hasShadow:  hasShadow(light.recent),
  light_legend_hasShadow:  hasShadow(light.legend),
  cyber_recent_hasShadow:  hasShadow(cyber.recent),
  cyber_legend_hasShadow:  hasShadow(cyber.legend),
  themes_differ:           light.recent !== cyber.recent,
  computed_resolves:       hasShadow(light.recentComputed) && hasShadow(cyber.recentComputed),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} panel elevation:`, JSON.stringify(results),
  `\n  light.recent=${JSON.stringify(light.recent)}`,
  `\n  cyber.recent=${JSON.stringify(cyber.recent)}`);
process.exit(ok ? 0 : 1);
