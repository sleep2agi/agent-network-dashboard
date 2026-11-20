// `.650` 回归测试：BFF 短缓存的三条不变量
//
// 为什么必须有测试：这份缓存是**跨请求**存活的，一旦 key 漏掉用户维度，
// 就会把一个用户可见的人员目录发给另一个用户——这类错误在页面上看不出来。
import assert from 'node:assert/strict';
import test from 'node:test';
import { cachedJson, cacheKey, __clearHubResponseCache } from '../app/lib/hub-response-cache.ts';

const params = (o: Record<string, string>) => new URLSearchParams(o);
const ok = (v: unknown) => async () => ({ status: 200, json: v });

test('缓存键：不同用户 token 必须得到不同的 key', () => {
  const p = params({ network_id: 'net_1', limit: '200' });
  const a = cacheKey('people', 'token-a', p);
  const b = cacheKey('people', 'token-b', p);
  assert.notEqual(a, b, '同一网络不同用户共用一个 key 会把 A 的可见范围发给 B');
  assert.equal(a, cacheKey('people', 'token-a', params({ limit: '200', network_id: 'net_1' })), '参数顺序不该改变 key');
});

test('命中：TTL 内第二次调用不触发上游', async () => {
  __clearHubResponseCache();
  let calls = 0;
  const load = async () => { calls += 1; return { status: 200, json: { ok: true, n: calls } }; };
  const first = await cachedJson('k1', 10_000, load);
  const second = await cachedJson('k1', 10_000, load);
  assert.equal(calls, 1);
  assert.equal(first.hit, false);
  assert.equal(second.hit, true);
  assert.deepEqual(second.json, { ok: true, n: 1 });
});

test('过期：TTL 之后重新打上游', async () => {
  __clearHubResponseCache();
  let calls = 0;
  const load = async () => { calls += 1; return { status: 200, json: { n: calls } }; };
  await cachedJson('k2', 5, load);
  await new Promise((r) => setTimeout(r, 20));
  const again = await cachedJson('k2', 5, load);
  assert.equal(calls, 2);
  assert.equal(again.hit, false);
});

test('单飞：并发相同请求只打一次上游', async () => {
  __clearHubResponseCache();
  let calls = 0;
  const load = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 20));
    return { status: 200, json: { ok: true } };
  };
  const all = await Promise.all([cachedJson('k3', 10_000, load), cachedJson('k3', 10_000, load), cachedJson('k3', 10_000, load)]);
  assert.equal(calls, 1, '并发的 2D/3D 页面请求应共享同一次在途调用');
  assert.ok(all.every((r) => r.status === 200));
});

test('失败不缓存：一次 502 不该被冻住整个 TTL', async () => {
  __clearHubResponseCache();
  let calls = 0;
  const failing = async () => { calls += 1; return { status: 502, json: { ok: false } }; };
  await cachedJson('k4', 10_000, failing);
  const second = await cachedJson('k4', 10_000, failing);
  assert.equal(calls, 2);
  assert.equal(second.hit, false);
});

test('404 原样透传（老 Hub 没有 departments 路由时前端要回退）', async () => {
  __clearHubResponseCache();
  const r = await cachedJson('k5', 10_000, async () => ({ status: 404, json: { ok: false, error: 'not_found' } }));
  assert.equal(r.status, 404);
});
