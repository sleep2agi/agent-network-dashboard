/* v0.10.0 Hero 1+2 — ServersDrawer extension screenshot evidence for #140.
 * Mocks the /api/hub/servers response with disk + history + agents
 * to surface the new expandable detail view. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const out = process.argv[2] || 'screenshots/r293-p0/servers-drawer-expanded';
const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    // Force drawer open + expand the first card by hostname guess.
    localStorage.setItem('anet-servers-drawer', '1');
    localStorage.setItem('anet-servers-drawer-expanded', JSON.stringify(['mock-1', 'mock-2']));
  } catch {}
});

// Mock servers payload with full v0.10.0 schema.
await ctx.route('**/api/hub/servers*', (route) => {
  route.fulfill({
    json: {
      servers: [
        {
          hostname: 'mock-1',
          ip: '10.0.0.10',
          cpu_load_1min: 2.4,
          cpu_cores: 8,
          mem_used_gb: 18.2,
          mem_total_gb: 32,
          disk_used_gb: 220,
          disk_total_gb: 500,
          cpu_history: [25, 28, 32, 30, 35, 38, 40, 36, 33, 30],
          mem_history: [50, 52, 55, 56, 58, 57, 59, 60, 58, 57],
          disk_history: [40, 42, 43, 43, 44, 44, 44, 44, 44, 44],
          agents: [
            { alias: 'claude-1', runtime: 'claude-code-cli', status: 'working', progress: 0.42 },
            { alias: 'codex-1', runtime: 'codex-sdk', status: 'working', progress: 0.18 },
            { alias: 'intern-1', runtime: 'claude-agent-sdk', status: 'idle' },
          ],
          agent_count: 3,
          status: 'online',
        },
        {
          hostname: 'mock-2',
          ip: '10.0.0.11',
          cpu_load_1min: 7.1,
          cpu_cores: 4,
          mem_used_gb: 14.5,
          mem_total_gb: 16,
          disk_used_gb: 460,
          disk_total_gb: 500,
          cpu_history: [80, 88, 92, 95, 96, 94, 93, 91, 90, 89],
          mem_history: [85, 87, 89, 91, 90, 92, 93, 91, 90, 91],
          disk_history: [86, 88, 89, 90, 90, 91, 92, 92, 92, 92],
          agents: [
            { alias: 'minimax-busy', runtime: 'claude-code-cli', status: 'working', progress: 0.78 },
          ],
          agent_count: 1,
          status: 'online',
        },
        {
          hostname: 'mock-offline',
          ip: '10.0.0.20',
          cpu_load_1min: null,
          cpu_cores: 0,
          mem_used_gb: null,
          mem_total_gb: null,
          agent_count: 2,
          status: 'offline',
          note: 'last seen 12m ago',
        },
      ],
    },
  });
});
await ctx.route('**/api/hub/status*', (r) => r.fulfill({ json: { sessions: [], hub: { networks: [] } } }));
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-server-card]', { timeout: 15000 });
await page.waitForTimeout(800);

// Crop to the drawer region only.
const box = await page.evaluate(() => {
  const aside = document.querySelector('[aria-label="Servers panel"]');
  if (!aside) return null;
  const r = aside.getBoundingClientRect();
  return { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: Math.min(r.height + 16, 980) };
});
if (box && box.width > 100) {
  await page.screenshot({ path: `${out}.png`, clip: box });
}
await page.screenshot({ path: `${out}-full.png`, fullPage: false });
console.log(`✅ wrote ${out}.png + ${out}-full.png`);
await browser.close();
