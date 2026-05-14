/* Issue #105 verification: TaskChatPanel + ChatPopover follow the dashboard
 * light / dark theme (CSS design tokens, no hardcoded darks). Checks the
 * popover panel + header + input resolve to a light surface under
 * data-theme="light" and a dark one under "cyber", and captures both. */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
mkdirSync('/tmp/anet-issue-105', { recursive: true });
const browser = await chromium.launch({ headless: true });

// crude luminance from "rgb(r, g, b)" — >128 = light surface
const isLight = (rgb) => {
  const m = rgb.match(/\d+/g);
  if (!m) return null;
  const [r, g, b] = m.map(Number);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 128;
};

async function run(theme, expectLight) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript((th) => {
    try {
      localStorage.setItem('anet-theme', th);
      localStorage.removeItem('anet-brand');
      localStorage.removeItem('anet-topo-view');
      localStorage.setItem('anet-topo-layout', 'grid');
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  }, theme);
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const fleet = Array.from({ length: 4 }, (_, i) => ({
      alias: `节点${i + 1}号`, status: 'idle', network_id: nid,
      created_at: '2026-05-15T00:00:00Z', updated_at: '2026-05-15T00:00:00Z', last_seen_at: '2026-05-15T00:00:00Z',
    }));
    await route.fulfill({ response: r, json: { ...b, sessions: fleet } });
  });
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [
    { task_id: 't1', from_name: 'Dashboard', to_name: '节点1号', status: 'replied', priority: 'normal',
      content: 'ping', result: 'pong — **ready**', created_at: '2026-05-15T00:00:00Z' },
  ] } }));

  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    return !!svg && svg.querySelectorAll('circle[r="26"]').length > 0;
  }, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(700);

  // open the chat popover
  const ring = page.locator('svg[viewBox="0 0 1000 680"] circle[r="26"]').first();
  const bb = await ring.boundingBox();
  if (bb) await page.mouse.wheel(0, bb.y - 160);
  await page.waitForTimeout(150);
  await ring.click({ force: true });
  await page.waitForTimeout(500);

  const popover = page.locator('[role="dialog"][aria-label^="Chat with"]');
  const results = {};

  const panelBg = await popover.evaluate(el => getComputedStyle(el).backgroundColor);
  results.panelMatchesTheme = isLight(panelBg) === expectLight;

  // header (first child div) + its title text colour
  const header = popover.locator('div').first();
  const headerBg = await header.evaluate(el => getComputedStyle(el).backgroundColor);
  results.headerMatchesTheme = isLight(headerBg) === expectLight;
  const titleColor = await header.locator('div.text-sm').first().evaluate(el => getComputedStyle(el).color);
  // title text must contrast the panel: dark text on light theme, light on dark
  results.titleContrasts = isLight(titleColor) === !expectLight;

  // input textarea surface
  const ta = popover.locator('textarea');
  const taBg = await ta.evaluate(el => getComputedStyle(el).backgroundColor);
  results.inputMatchesTheme = isLight(taBg) === expectLight;

  await page.screenshot({ path: `/tmp/anet-issue-105/chat-${theme}.png` });
  await ctx.close();

  const ok = results.panelMatchesTheme && results.headerMatchesTheme &&
    results.titleContrasts && results.inputMatchesTheme;
  console.log(`${ok ? '✅' : '❌'} [${theme}] expectLight=${expectLight}:`, JSON.stringify(results), `panelBg=${panelBg}`);
  return ok;
}

const all = [];
all.push(await run('cyber', false));
all.push(await run('light', true));
await browser.close();
const pass = all.every(Boolean);
console.log(pass ? '\n✅ ALL PASS' : '\n❌ FAIL');
process.exit(pass ? 0 : 1);
