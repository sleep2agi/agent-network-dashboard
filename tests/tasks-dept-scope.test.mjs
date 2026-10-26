import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 契约：部门筛选是「通讯录投影」，不是服务端过滤。
//
// Hub 的任务接口只有 status / from_name / to_name。Dashboard 想做「看某个部门
// 的任务」只能拿 alias→人→部门 反查、在客户端过滤。这会带来两个必须写死的
// 约束，否则就是骗人：
//   1. 命中数只代表「当前这一页任务里」的命中，UI 必须写明口径；
//   2. 筛不到时不能说「该部门没有任务」，只能说「这批任务里没有」。

const root = join(import.meta.dir, '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

describe('部门任务筛选必须标明投影口径', () => {
  const view = read('app/tasks/TasksView.tsx');

  test('使用共享纯函数过滤，而不是组件里手写映射', () => {
    expect(view).toContain("from '../lib/dept-task-filter'");
    expect(view).toContain('filterTasksByDept');
    expect(view).toContain('collectDeptSubtree');
  });

  test('状态计数与列表都基于筛选后的集合', () => {
    expect(view).toContain('const tasksScoped = deptIds.size > 0 ? deptScopedTasks : tasks;');
    expect(view).toContain('tasksScoped.forEach');
    expect(view).toContain('<TaskList tasks={tasksScoped}');
  });

  test('口径说明与「这批任务里没有」的空态都在，不能冒充部门全量', () => {
    expect(view).toContain('data-testid="tasks-dept-scope"');
    expect(view).toMatch(/投影结果，不是部门全量/);
    expect(view).toMatch(/这个部门在当前这批任务里没有记录/);
  });
});
