import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 契约：读失败 ≠ 没有数据。
//
// 事故形状（2026-10-26）：`/api/hub/status` 是 SWR 的共享 key，Sidebar 注册的
// statusFetcher 在非 2xx 时返回 `{ sessions: [] }`。SWR 缓存按 key 去重，
// 于是 Sidebar 先解析出的「空」污染了整张页面：/nodes 显示「npx init 建第一个
// Agent」、/versions 显示「当前网络没有在线会话」、/messages 显示空态——全是
// 把「Hub 读不到」说成「本来就没有」。断言写在源码契约层，因为复现它需要
// 一个会返回 5xx 的 Hub（e2e 里很难稳定挡在缓存去重之前）。

const root = join(import.meta.dir, '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

describe('读失败必须冒泡，不能伪装成空数据', () => {
  test('共享 fetcher 对非 2xx 抛错（而不是 res.json() 当数据）', () => {
    const src = read('app/lib/hooks.ts');
    const fetcher = src.slice(src.indexOf('const fetcher'), src.indexOf('const SWR_OPTIONS'));
    expect(fetcher).toContain('if (!res.ok)');
    expect(fetcher).toMatch(/throw Object\.assign\(/);
  });

  test('Sidebar 的 statusFetcher 不再把非 2xx 吞成 { sessions: [] }', () => {
    const src = read('app/components/Sidebar.tsx');
    const start = src.indexOf('const statusFetcher');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, start + 600);
    expect(body).toContain('if (!res.ok)');
    expect(body).not.toContain(': { sessions: [] }');
    // 同一 key 被多处注册；任何一处吞错都会重新污染缓存。
    const swallow = /'\/api\/hub\/status'[^)]*\)\s*\.then\(\s*r\s*=>\s*r\.ok\s*\?/;
    expect(swallow.test(src)).toBe(false);
  });

  test('代理层不再把上游 5xx 透传成 200', () => {
    for (const rel of ['app/api/hub/status/route.ts', 'app/api/hub/messages/route.ts']) {
      const src = read(rel);
      expect(src).toContain('if (!res.ok)');
      expect(src).toMatch(/status: res\.status/);
    }
    const tasks = read('app/api/hub/tasks/route.ts');
    // /api/tasks 失败后回退 /api/completions；两个都挂时必须 502，
    // 否则返回 { ok: true, tasks: [] } —— 用户看到的是「暂无任务」。
    expect(tasks).toContain('if (!compRes.ok)');
  });

  test('页面在 error 时不得渲染空态引导', () => {
    const nodes = read('app/nodes/NodesView.tsx');
    expect(nodes).toMatch(/loadError\s*&&\s*sessions\.length === 0/);
    const tasks = read('app/tasks/TasksView.tsx');
    expect(tasks).toMatch(/error\s*&&\s*tasks\.length === 0/);
    const versions = read('app/versions/page.tsx');
    expect(versions).toContain('failed');
    const messages = read('app/messages/page.tsx');
    expect(messages).toMatch(/error\s*&&\s*messages\.length === 0/);
  });
});
