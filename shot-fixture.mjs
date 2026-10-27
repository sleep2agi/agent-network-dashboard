import { chromium } from 'playwright';
const base = 'http://127.0.0.1:3106';
const pw = process.env.PW;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.request.post(base + '/api/auth/login', { data: { password: pw } });
await ctx.addInitScript(() => {
  sessionStorage.setItem('anet_v3_auth', JSON.stringify({
    user: { username: 'probe', role: 'owner' }, token: 'probe-token',
    networks: [{ network_id: 'net_probe', network_name: 'probe' }], currentNetwork: 'net_probe',
  }));
});
const nodes = Array.from({ length: 12 }, (_, i) => ({
  node_id: 'n_' + i, alias: ['通信欧','通信牛','TMA云盘欧','TMWork甲','ANet工程欧'][i % 5] + (i > 4 ? i : ''),
  runtime: 'opencode-sdk', model: 'deepseek/deepseek-flash', server: 'iZrj93',
  status: i % 3 === 0 ? 'working' : 'idle', last_seen_at: '2026-10-27 09:30:00',
  department_id: null, lifecycle_state: 'active',
}));
await ctx.route('**/api/hub/**', async (route) => {
  const u = route.request().url();
  if (u.includes('/nodes')) return route.fulfill({ json: { ok: true, nodes } });
  if (u.includes('/people')) return route.fulfill({ json: { ok: true, total: 1, people: [{ username: 'vansin', display_name: 'Vincent', agents: [] }], has_more: false } });
  if (u.includes('/health')) return route.fulfill({ json: { ok: true, version: '0.9.0-preview.172', sse_sessions: {}, sessions: 12 } });
  if (u.includes('/departments')) return route.fulfill({ json: { departments: [{ id: 'd1', name: 'TMAI', parent_id: null }], members: [] } });
  return route.fulfill({ json: { ok: true } });
});
const p = await ctx.newPage();
for (const [path, name] of [['/nodes','nodes'],['/settings','settings'],['/legion/3d','legion3d'],['/requirements','requirements']]) {
  await p.goto(base + path, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);
  await p.screenshot({ path: '/tmp/topo2/after-' + name + '.png' });
}
console.log('shot done');
await b.close();
