import { describe, expect, test } from 'bun:test';
import {
  buildAliasUserMap,
  buildUserDeptMap,
  collectDeptSubtree,
  deptOptions,
  filterTasksByDept,
  taskInDept,
} from './dept-task-filter';

const people = [
  { user_id: 'u1', username: 'a', display_name: 'A', role: 'owner', department: { id: 'd1', name: '平台组' }, agents: [{ node_id: 'n1', alias: '通信Dash欧' }, { node_id: 'n2', alias: '通信欧' }] },
  { user_id: 'u2', username: 'b', display_name: 'B', role: 'member', department: { id: 'd2', name: '前端组' }, agents: [{ node_id: 'n3', alias: '前端欧' }] },
  { user_id: 'u3', username: 'c', display_name: 'C', role: 'member', department: null, agents: [] },
];

const departments = [
  { id: 'd1', name: '平台组', parent_id: null },
  { id: 'd2', name: '前端组', parent_id: 'd1' },
  { id: 'd3', name: '客户端组', parent_id: null },
];

describe('#部门任务投影 — alias→人→部门，子部门要一起算', () => {
  test('alias 反查：只认通讯录里存在的 Agent', () => {
    const map = buildAliasUserMap(people);
    expect(map.get('通信Dash欧')).toBe('u1');
    expect(map.get('前端欧')).toBe('u2');
    expect(map.get('不存在')).toBeUndefined();
  });

  test('人 → 部门：members 表是权威 —— null 表示「明确未分配」，不再回退', () => {
    const withMembers = buildUserDeptMap(people, [{ user_id: 'u1', department_id: 'd2' }, { user_id: 'u2', department_id: null }]);
    expect(withMembers.get('u1')).toBe('d2'); // 被管理员挪到前端组，以 members 为准
    expect(withMembers.has('u2')).toBe(false); // 明确未分配：不回退到 person.department 的旧值
    const noMembers = buildUserDeptMap(people, null);
    expect(noMembers.get('u2')).toBe('d2'); // 没有落位表才用 person.department
    expect(noMembers.has('u3')).toBe(false);
  });

  test('子树展开：筛平台组要带上前端组，但不带无关的客户端组', () => {
    const set = collectDeptSubtree(departments, 'd1');
    expect([...set].sort()).toEqual(['d1', 'd2']);
    expect(collectDeptSubtree(departments, 'd3').size).toBe(1);
    // 没有部门树（老 Hub）时只返回自己，不抛错
    expect([...collectDeptSubtree(null, 'd1')]).toEqual(['d1']);
  });

  test('任务命中：from 或 to 任一落在部门集合即可', () => {
    const aliasUser = buildAliasUserMap(people);
    const userDept = buildUserDeptMap(people, null);
    const d1 = collectDeptSubtree(departments, 'd1');
    expect(taskInDept({ from_name: '通信Dash欧', to_name: '外部' }, aliasUser, userDept, d1)).toBe(true);
    expect(taskInDept({ from_name: '外部', to_name: '前端欧' }, aliasUser, userDept, d1)).toBe(true);
    expect(taskInDept({ from_name: '外部', to_name: '外部2' }, aliasUser, userDept, d1)).toBe(false);
  });

  test('兼容路径只给 from_alias/to_alias 时也能筛出来', () => {
    const aliasUser = buildAliasUserMap(people);
    const userDept = buildUserDeptMap(people, null);
    const d1 = collectDeptSubtree(departments, 'd1');
    expect(taskInDept({ from_alias: '通信欧', to_alias: '外部' }, aliasUser, userDept, d1)).toBe(true);
  });

  test('过滤：空部门集合视为不过滤（不要因为没选部门就把列表清空）', () => {
    const aliasUser = buildAliasUserMap(people);
    const userDept = buildUserDeptMap(people, null);
    const tasks = [
      { task_id: 't1', from_name: '通信欧', to_name: '外部' },
      { task_id: 't2', from_name: '外部', to_name: '前端欧' },
      { task_id: 't3', from_name: '外部', to_name: '外部2' },
    ];
    expect(filterTasksByDept(tasks, aliasUser, userDept, new Set())).toHaveLength(3);
    const filtered = filterTasksByDept(tasks, aliasUser, userDept, collectDeptSubtree(departments, 'd3'));
    expect(filtered).toHaveLength(0); // 客户端组名下没人
  });

  test('下拉选项：带层级深度，按名称排序；无部门树时用通讯录合成', () => {
    const opts = deptOptions(departments, people, null);
    expect(opts.map(o => o.id)).toEqual(['d3', 'd1', 'd2']); // 客户端组 / 平台组 / 前端组
    expect(opts.find(o => o.id === 'd2').depth).toBe(1);
    expect(opts.find(o => o.id === 'd1').depth).toBe(0);

    const flat = deptOptions(null, people, null);
    expect(flat.map(o => o.id).sort()).toEqual(['d1', 'd2']);
    expect(flat.every(o => o.depth === 0)).toBe(true);
  });
});
