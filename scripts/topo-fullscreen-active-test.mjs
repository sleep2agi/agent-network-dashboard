/* Round 178 verification: fullscreen chrome button picks up the
 * active-state visual indicator R163 introduced for layout toggle.
 *
 * Pre-R178 the button changed icon when isFullscreen flipped but
 * background + foreground stayed unchanged. R178 adds:
 *   active:   bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/20
 *   inactive: hover:bg-white/5 + palette-driven inline bg/color
 *
 * Mirrors R163 Ring/Grid pattern.
 *
 * Test:
 *   1. Probe inactive state (default — not in fullscreen):
 *        data-topo-chrome-fullscreen-active='false'
 *        className does NOT include 'bg-cyan-500/15'
 *        className includes 'hover:bg-white/5'
 *        inline style.background is set (from palette)
 *   2. Fake fullscreen state via dispatching fullscreenchange
 *      with mocked document.fullscreenElement, then re-probe:
 *        data-topo-chrome-fullscreen-active='true'
 *        className includes 'bg-cyan-500/15' + 'text-cyan-300'
 *        className DOES NOT include 'hover:bg-white/5'
 *        inline style.background is unset (Tailwind wins)
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
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta'), mk('gamma')] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-topo-chrome-fullscreen]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = () => page.evaluate(() => {
  const btn = document.querySelector('[data-topo-chrome-fullscreen]');
  if (!btn) return null;
  return {
    activeAttr:        btn.getAttribute('data-topo-chrome-fullscreen-active'),
    className:         btn.getAttribute('class') || '',
    inlineBg:          btn.style.background || '',
    inlineColor:       btn.style.color || '',
    ariaLabel:         btn.getAttribute('aria-label'),
  };
});

const inactive = await probe();

// Fake fullscreen state: define document.fullscreenElement to point at
// the container, then dispatch fullscreenchange. The listener at
// TopoGraph.tsx line ~1125 calls
//   setIsFullscreen(document.fullscreenElement === containerRef.current)
// We can find the container via the chrome's parent (the chrome <div>
// sits inside the container <div ref={containerRef}>).
await page.evaluate(() => {
  const chrome = document.querySelector('[data-topo-chrome]');
  const container = chrome?.parentElement;
  if (!container) throw new Error('container not found');
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => container,
  });
  document.dispatchEvent(new Event('fullscreenchange'));
});
await page.waitForTimeout(250);
const active = await probe();

await browser.close();

const results = {
  // Inactive defaults
  inactive_attr_false:         inactive.activeAttr === 'false',
  inactive_no_cyan_bg_class:   !inactive.className.includes('bg-cyan-500/15'),
  inactive_has_white_hover:    inactive.className.includes('hover:bg-white/5'),
  inactive_inline_bg_set:      inactive.inlineBg !== '',
  inactive_inline_color_set:   inactive.inlineColor !== '',
  inactive_aria_label_enter:   /Enter fullscreen/.test(inactive.ariaLabel || ''),

  // Active state (after faking fullscreenchange)
  active_attr_true:            active.activeAttr === 'true',
  active_has_cyan_bg_class:    active.className.includes('bg-cyan-500/15'),
  active_has_cyan_text_class:  active.className.includes('text-cyan-300'),
  active_has_cyan_hover_class: active.className.includes('hover:bg-cyan-500/20'),
  active_no_white_hover:       !active.className.includes('hover:bg-white/5'),
  active_inline_bg_empty:      active.inlineBg === '',
  active_inline_color_empty:   active.inlineColor === '',
  active_aria_label_exit:      /Exit fullscreen/.test(active.ariaLabel || ''),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} fullscreen active state:`, JSON.stringify(results),
  `\n  inactive =`, inactive,
  `\n  active   =`, active);
process.exit(ok ? 0 : 1);
