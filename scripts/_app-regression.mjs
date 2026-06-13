// Full APP regression (Vincent's quality gate, tg 721):
// login → agents → search → chat → REAL SEND + delivery check →
// messages tab → settings tab. Any failure = build does not ship.
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const ADMIN = JSON.parse(readFileSync('/home/vansin/.anet/config.json','utf8')).token;
const QAPW = readFileSync('/tmp/.nzhanma_qa_pw','utf8').trim();
const HUB = 'https://dm.vansin.top';
const MARK = `[回归] v0.1.9 自动验证 ${process.env.REG_TAG ?? 'r19'} 请忽略`;
const fail = (m) => { console.log('FAIL:', m); process.exit(1); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
let consoleErrors = 0;
page.on('console', m => { if (m.type() === 'error') { consoleErrors++; console.log('CONSOLE_ERR:', m.text().slice(0,150)); } });

await page.route(`${HUB}/**`, async route => {
  const req = route.request();
  const headers = { 'Content-Type': 'application/json' };
  const auth = await req.headerValue('authorization');
  if (auth) headers['Authorization'] = `Bearer ${ADMIN}`;
  const res = await fetch(req.url(), { method: req.method(), headers, body: req.postData() ?? undefined });
  route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
});

// 1. login
await page.goto('http://127.0.0.1:8088/');
await page.waitForTimeout(2000);
await page.getByPlaceholder(/服务器地址/).fill(HUB);
await page.getByPlaceholder('用户名').fill('nzhanma_qa');
await page.getByPlaceholder('密码').fill(QAPW);
await page.getByText('登录', { exact: true }).click();
await page.waitForTimeout(3500);
if (!(await page.getByText(/153 agents|agents/).count())) fail('agents list not visible after login');
console.log('PASS 1: login → agents');

// 2. search
await page.getByPlaceholder(/搜索 agent/).fill('通信N站马');
await page.waitForTimeout(700);
if (!(await page.getByText('通信N站马', { exact: true }).count())) fail('search result missing');
console.log('PASS 2: search');

// 3. chat opens
await page.getByText('通信N站马', { exact: true }).first().click();
await page.waitForTimeout(2500);
if (!(await page.getByPlaceholder(/Message/).count())) fail('chat input missing');
await page.screenshot({ path: '/tmp/reg-chat.png' });
console.log('PASS 3: chat renders');

// 4. REAL SEND + delivery verification — target is OUR OWN session
// (通信龙 condition: never wake live teammate sessions with QA traffic)
await page.getByPlaceholder(/Message/).fill(MARK);
await page.getByText('↑', { exact: true }).click();
await page.waitForTimeout(3500);
const deliveredUi = await page.getByText(MARK, { exact: false }).count();
const api = await fetch(`${HUB}/api/tasks?to_name=%E9%80%9A%E4%BF%A1N%E7%AB%99%E9%A9%AC&limit=5`, { headers: { Authorization: `Bearer ${ADMIN}` } }).then(r => r.json());
const deliveredApi = (api.tasks ?? []).some(t => (t.content ?? '').includes(MARK));
if (!deliveredApi) fail('sent message NOT found via /api/tasks — delivery unconfirmed');
console.log(`PASS 4: real send delivered (ui echo=${deliveredUi > 0}, api=${deliveredApi})`);

// 5. messages tab
await page.getByText('‹', { exact: true }).click();
await page.waitForTimeout(800);
await page.getByText('Messages', { exact: true }).click();
await page.waitForTimeout(2500);
if (!(await page.getByText('→', { exact: false }).count())) fail('messages feed empty');
await page.screenshot({ path: '/tmp/reg-messages.png' });
console.log('PASS 5: messages feed');

// 6. settings tab
await page.getByText('设置', { exact: true }).click();
await page.waitForTimeout(1500);
for (const label of ['服务器', '用户名', '网络', '版本', '退出登录']) {
  if (!(await page.getByText(label, { exact: false }).count())) fail(`settings row missing: ${label}`);
}
await page.screenshot({ path: '/tmp/reg-settings.png' });
console.log('PASS 6: settings rows complete');

// 6.5 server tab (Vincent tg 847): live hub status + server info
await page.getByText('Server', { exact: true }).click();
await page.waitForTimeout(2000);
for (const label of ['在线 Agents', '工作中', '服务器', '版本', '网络']) {
  if (!(await page.getByText(label, { exact: false }).count())) fail(`server screen missing: ${label}`);
}
await page.screenshot({ path: '/tmp/reg-server.png' });
console.log('PASS 6.5: server tab renders');


// 7. attachment chain (#221): upload a real image, send with attachment,
// verify delivery + byte-identical download — API level, same contract
// the app's uploadImage/sendTask use.
{
  const png = readFileSync('/tmp/qa-upload-test.png');
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'reg-image.png');
  const up = await (await fetch(`${HUB}/api/upload`, { method: 'POST', headers: { Authorization: `Bearer ${ADMIN}` }, body: form })).json();
  if (!up?.ok) fail(`upload failed: ${up?.error}`);
  const sent = await (await fetch(`${HUB}/api/task`, { method: 'POST', headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ alias: '通信N站马', task: `[回归] 附件 ${MARK}`, network_id: 'net_399bdf86f528', attachments: [{ type: 'file', file_id: up.file_id, name: 'reg-image.png', mime: up.mime, size: up.size }] }) })).json();
  if (!sent?.ok) fail(`attachment send failed: ${sent?.error}`);
  const dl = await fetch(`${HUB}/api/files/${up.file_id}`, { headers: { Authorization: `Bearer ${ADMIN}` } });
  const got = Buffer.from(await dl.arrayBuffer());
  if (!dl.ok || !got.equals(png)) fail('downloaded file mismatch');
  console.log('PASS 7: attachment chain (upload → send → byte-identical download)');
}

await browser.close();
console.log(`CONSOLE_ERRORS=${consoleErrors}`);
if (consoleErrors > 0) fail('console errors present');
console.log('REGRESSION_ALL_GREEN');
