/* Round 187 verification: FreshnessChip color transition.
 *
 * Pre-R187 the chip swapped between fresh (gray) and stale
 * (amber) Tailwind classes — bg/text/border snapped every
 * time the >10s boundary was crossed. R187 adds
 * transition-colors duration-300 so the palette eases
 * smoothly through the stale-onset and recovery.
 *
 * Test:
 *   1. Mount: data-freshness-chip-stale='false' (just synced)
 *   2. className includes transition-colors + duration-300
 *   3. className includes gray fresh palette
 *   4. computed transition string includes background-color,
 *      border-*, color properties
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
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta')] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 2, { timeout: 30000 });
await page.waitForSelector('[data-freshness-chip]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const chip = document.querySelector('[data-freshness-chip]');
  if (!chip) return null;
  const computed = getComputedStyle(chip);
  return {
    staleAttr:    chip.getAttribute('data-freshness-chip-stale'),
    className:    chip.getAttribute('class') || '',
    transition:   computed.transitionProperty + ' / ' + computed.transitionDuration,
    text:         chip.textContent,
  };
});

await browser.close();

const results = {
  chip_found:                probe !== null,
  initial_stale_false:       probe?.staleAttr === 'false',
  has_transition_colors:     probe?.className.includes('transition-colors'),
  has_duration_300:          probe?.className.includes('duration-300'),
  has_fresh_palette_bg:      probe?.className.includes('bg-gray-500/10'),
  has_fresh_palette_text:    probe?.className.includes('text-gray-400'),
  has_fresh_palette_border:  probe?.className.includes('border-gray-500/20'),
  no_stale_palette:          !probe?.className.includes('bg-amber-500/10'),
  transition_covers_bg:      (probe?.transition || '').includes('background-color'),
  transition_covers_border:  (probe?.transition || '').includes('border'),
  transition_covers_color:   (probe?.transition || '').match(/(^|[\s,/])color\b/),
  text_shows_live:           /^live ·/.test(probe?.text || ''),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} freshness chip transition:`, JSON.stringify(Object.fromEntries(Object.entries(results).map(([k,v]) => [k, !!v]))),
  `\n  probe:`, probe);
process.exit(ok ? 0 : 1);
