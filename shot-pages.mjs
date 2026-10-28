import { chromium } from 'playwright';
const base = 'http://127.0.0.1:3105';
const pw = process.env.PW;

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const res = await ctx.request.post(base + '/api/auth/login', { data: { password: pw } });
console.log('login:', res.status(), await res.text());
const p = await ctx.newPage();
for (const [path, name] of [['/requirements','requirements'],['/nodes','nodes'],['/legion/3d','legion3d'],['/settings','settings']]) {
  await p.goto(base + path, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `/tmp/topo2/page-${name}.png` });
  console.log(name, '| url:', p.url());
}
await b.close();
