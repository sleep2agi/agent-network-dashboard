import { chromium } from 'playwright';
const base = 'http://127.0.0.1:3107';
const pw = process.env.PW;
const groups = ['TMWork','TM知识库','TM门户','TM基建','OODA','ANet'];
const people = ['通信欧','通信牛','TMA云盘欧','TMWork甲','ANet工程欧','通信龙','TMAI鲸','通信Dash欧'];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.request.post(base + '/api/auth/login', { data: { password: pw } });
await ctx.addInitScript(() => sessionStorage.setItem('anet_v3_auth', JSON.stringify({
  user:{username:'probe',role:'owner'}, token:'t', networks:[{network_id:'net_probe',network_name:'probe'}], currentNetwork:'net_probe'})));
await ctx.route('**/api/hub/**', async (route) => {
  const u = route.request().url();
  if (u.includes('/departments')) return route.fulfill({ json: { ok: true,
    departments: groups.map((g,i)=>({ id:'d'+i, name:g, parent_id: g==='TMWork'||g==='TM知识库'||g==='TM门户'||g==='TM基建'||g==='OODA' ? 'd5' : null, sort:i })),
    members: people.map((p,i)=>({ username:'u'+i, display_name:p, department_id:'d'+(i%groups.length), name:p })),
  }});
  if (u.includes('/people')) return route.fulfill({ json: { ok:true, total: people.length,
    people: people.map((p,i)=>({ username:'u'+i, display_name:p, department_id:'d'+(i%groups.length), agents:[] })), has_more:false } });
  if (u.includes('/nodes')) return route.fulfill({ json: { ok:true, nodes: people.map((p,i)=>({ node_id:'n'+i, alias:p, runtime:'opencode-sdk', status: i%3?'idle':'working', department_id:'d'+(i%groups.length) })) } });
  if (u.includes('/health')) return route.fulfill({ json: { ok:true, version:'x', sse_sessions:{}, sessions: people.length } });
  return route.fulfill({ json: { ok:true } });
});
const p = await ctx.newPage();
await p.goto(base + '/legion/3d', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(3500);
await p.screenshot({ path: '/tmp/topo2/legion-groups.png' });
console.log('done');
await b.close();
