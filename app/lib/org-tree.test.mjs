import { describe, expect, test } from 'bun:test';
import { buildOrgGroups, filterOrgPeople, UNASSIGNED_GROUP } from './org-tree';

const person = (over = {}) => ({
  user_id: 'u1', username: 'vansin', display_name: 'Vincent', role: 'owner',
  department: { id: 'd1', name: '平台' }, agents: [], ...over,
});
const agent = (i) => ({ node_id: `n_${i}`, alias: `agent-${i}` });

describe('#1636 /org 树形分组 — 真部门树与扁平回退共用一套输出', () => {
  test('没有部门树时回退成一层，未分组排最后', () => {
    const tree = buildOrgGroups({
      people: [
        person({ user_id: 'u2', display_name: 'B', department: { id: 'd2', name: '文档' }, agents: [agent(1)] }),
        person({ user_id: 'u1', display_name: 'A', department: { id: 'd1', name: '平台' } }),
        person({ user_id: 'u3', display_name: 'C', department: null }),
      ],
    });
    expect(tree.fallback).toBe(true);
    expect(tree.depth).toBe(1);
    // 按中文名称排序（拼音），未分组恒定在最后
    expect(tree.groups.map(g => g.name)).toEqual(['平台', '文档', UNASSIGNED_GROUP]);
    expect(tree.groups.find(g => g.name === '文档').totalPeople).toBe(1);
    expect(tree.groups.find(g => g.name === '文档').totalAgents).toBe(1);
    expect(tree.groups.find(g => g.name === '平台').totalAgents).toBe(0);
  });

  test('真部门树：层级、负责人、含下级的合计', () => {
    const tree = buildOrgGroups({
      departments: [
        { id: 'd1', name: '平台', parent_id: null, leader_user_id: 'u1', sort: 1 },
        { id: 'd11', name: '前端', parent_id: 'd1', leader_user_id: 'u2', sort: 1 },
        { id: 'd12', name: '后端', parent_id: 'd1', sort: 2 },
        { id: 'd2', name: '设计', parent_id: null, leader_user_id: 'u4', sort: 2 },
      ],
      people: [
        person({ user_id: 'u1', display_name: 'Vincent', department: { id: 'd1', name: '平台' }, agents: [agent(1)] }),
        person({ user_id: 'u2', display_name: '林亦', department: { id: 'd11', name: '前端' } }),
        person({ user_id: 'u4', display_name: '神明', department: { id: 'd2', name: '设计' }, agents: [agent(2), agent(3)] }),
      ],
    });
    expect(tree.fallback).toBe(false);
    expect(tree.depth).toBe(2);
    expect(tree.groups.map(g => g.name)).toEqual(['平台', '设计']);
    const platform = tree.groups[0];
    expect(platform.leader).toBe('Vincent');
    expect(platform.children.map(g => [g.name, g.depth])).toEqual([['前端', 2], ['后端', 2]]);
    expect(platform.totalPeople).toBe(2);
    expect(platform.totalAgents).toBe(1);
    expect(tree.groups[1].totalAgents).toBe(2);
    // 直属成员只算直属，不把子部门的人算进来
    expect(platform.people.map(p => p.user_id)).toEqual(['u1']);
  });

  test('成员表覆盖 person.department（调动后以 Hub 落位为准）', () => {
    const tree = buildOrgGroups({
      departments: [{ id: 'd1', name: '平台', parent_id: null }, { id: 'd2', name: '文档', parent_id: null }],
      people: [person({ user_id: 'u1', department: { id: 'd1', name: '平台' } })],
      members: [{ user_id: 'u1', department_id: 'd2' }],
    });
    expect(tree.groups.find(g => g.name === '文档')?.people.map(p => p.user_id)).toEqual(['u1']);
    expect(tree.groups.find(g => g.name === '平台')?.people).toHaveLength(0);
  });

  test('部门 id 查不到的人进未分组，不丢人；父部门缺失的部门当顶层', () => {
    const tree = buildOrgGroups({
      departments: [{ id: 'd1', name: '平台', parent_id: 'ghost-parent' }],
      people: [
        person({ user_id: 'u1', department: { id: 'not-exist', name: '幽灵' } }),
        person({ user_id: 'u2', department: { id: 'd1', name: '平台' } }),
      ],
    });
    expect(tree.unassigned.map(p => p.user_id)).toEqual(['u1']);
    expect(tree.groups.map(g => g.name)).toEqual(['平台', UNASSIGNED_GROUP]);
    expect(tree.groups[1].people.map(p => p.user_id)).toEqual(['u1']);
  });

  test('空部门默认保留（空编也是信息），搜索时才剪掉', () => {
    const base = {
      departments: [
        { id: 'd1', name: '平台', parent_id: null },
        { id: 'd2', name: '空部门', parent_id: null },
      ],
      people: [person({ user_id: 'u1', department: { id: 'd1', name: '平台' } })],
    };
    expect(buildOrgGroups(base).groups.map(g => g.name)).toEqual(['空部门', '平台']);
    expect(buildOrgGroups(base, { hideEmpty: true }).groups.map(g => g.name)).toEqual(['平台']);
  });

  test('输入顺序不影响输出（同一份数据永远同一棵树）', () => {
    const departments = [
      { id: 'd1', name: '平台', parent_id: null, sort: 2 },
      { id: 'd2', name: '文档', parent_id: null, sort: 1 },
      { id: 'd11', name: '前端', parent_id: 'd1', sort: 1 },
    ];
    const people = [
      person({ user_id: 'u2', display_name: 'B', department: { id: 'd11', name: '前端' } }),
      person({ user_id: 'u1', display_name: 'A', department: { id: 'd1', name: '平台' } }),
      person({ user_id: 'u3', display_name: 'C', department: { id: 'd2', name: '文档' } }),
    ];
    const a = buildOrgGroups({ departments, people });
    const b = buildOrgGroups({ departments: [...departments].reverse(), people: [...people].reverse() });
    expect(b.groups.map(g => g.name)).toEqual(a.groups.map(g => g.name));
    expect(b.groups.map(g => g.people.map(p => p.user_id))).toEqual(a.groups.map(g => g.people.map(p => p.user_id)));
  });

  test('filterOrgPeople：姓名 / 用户名 / 名下 Agent 别名都能搜，空查询返回全部', () => {
    const people = [
      { user_id: 'u1', username: 'vincent', display_name: '文森特', role: 'owner', department: { id: 'd1', name: '平台' }, agents: [{ node_id: 'n1', alias: '通信Dash欧' }] },
      { user_id: 'u2', username: 'lin', display_name: '林工', role: 'member', department: { id: 'd2', name: '客户端' }, agents: [{ node_id: 'n2', alias: '客户端欧' }] },
      { user_id: 'u3', username: 'zhao', display_name: '赵工', role: 'member', department: null, agents: [] },
    ];
    expect(filterOrgPeople(people, '')).toHaveLength(3);
    expect(filterOrgPeople(people, '   ')).toHaveLength(3);          // 纯空格 = 不过滤
    expect(filterOrgPeople(people, '林').map(p => p.user_id)).toEqual(['u2']);
    expect(filterOrgPeople(people, 'VINCENT').map(p => p.user_id)).toEqual(['u1']); // 大小写不敏感
    expect(filterOrgPeople(people, '客户端欧').map(p => p.user_id)).toEqual(['u2']); // 按 Agent 别名
    expect(filterOrgPeople(people, '不存在')).toHaveLength(0);
  });
});
