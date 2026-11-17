/**
 * 军团 3D 的「示例数据」夹具（`.605` 起）。
 *
 * 用途：给官网首页 / README 头图提供可公开的演示数据 ——
 *   `/legion/3d?demo=1` 时**完全不发任何 /api/hub 请求**，只用这里的虚构数据。
 *
 * 硬规矩（任何人改这个文件之前先读完）：
 *   1. 这里只允许出现**虚构名字**（部门用星座名，成员/Agent 用编号）
 *   2. 不得从生产数据里"抄一份改几个字"—— 结构可以像，名字必须是造的
 *   3. 数量规模是给宣传用的：6 部门 / 24 成员 / 60 Agent（可调 SCALE）
 *
 * 结构对齐 `lib/legion-layout.ts` 的 LegionInput，以及 Hub 的
 * people / departments / session-status 三个响应里被用到的那几个字段。
 */

import type { LegionPerson, LegionAgentRef, LegionDepartment, LegionMember } from '../../lib/legion-layout';

export interface DemoPayload {
  people: LegionPerson[];
  orphans: LegionAgentRef[];
  departments: LegionDepartment[];
  members: LegionMember[];
  /** 给 statusByAlias 用：alias → status */
  sessions: Array<{ alias: string; status: string }>;
}

/**
 * 部门名（负责人 2026-11-17 指定）：用通用职能词，占位且不指向任何真实组织。
 * 六个平级部门 = 军团图上「核心 + 第一圈部门」，正好是首页门面要的构图。
 */
const DEPT_NAMES = ['研发', '设计', '运营', '市场', '客服', '财务'];

const SCALE = {
  departments: 6,
  members: 24,
  agents: 60,
  orphans: 0,
};

/**
 * 生成示例数据。
 * 成员与 Agent 均匀落到各部门；Agent 状态按 4/6 working、1/6 idle、
 * 少量 error/blocked 混排，让画面有层次（不是全绿也不全灰）。
 */
export function buildDemoData(): DemoPayload {
  const deptCount = Math.min(SCALE.departments, DEPT_NAMES.length);
  const departments: LegionDepartment[] = DEPT_NAMES.slice(0, deptCount).map((name, i) => ({
    id: `demo-dept-${i + 1}`,
    name,
    parent_id: null,
    leader_user_id: null,
    sort: i,
  }));

  const memberDeptIndex = (i: number) => i % deptCount;
  const members: LegionMember[] = [];
  const people: LegionPerson[] = [];
  const sessions: Array<{ alias: string; status: string }> = [];

  // 成员 + 各自名下的 Agent
  const agentsPerMember: number[] = [];
  let remaining = SCALE.agents;
  for (let i = 0; i < SCALE.members; i += 1) {
    const base = Math.floor(SCALE.agents / SCALE.members);
    const extra = remaining > base * (SCALE.members - i) ? 1 : 0;
    const n = base + extra;
    remaining -= n;
    agentsPerMember.push(n);
  }

  let agentSeq = 0;
  for (let i = 0; i < SCALE.members; i += 1) {
    const dept = departments[memberDeptIndex(i)];
    const user_id = `demo-user-${String(i + 1).padStart(2, '0')}`;
    const username = `m-${String(i + 1).padStart(2, '0')}`;
    const agents: LegionAgentRef[] = [];
    for (let k = 0; k < agentsPerMember[i]; k += 1) {
      agentSeq += 1;
      // Agent 别名（负责人指定格式）：P-01 … P-60
      const alias = `P-${String(agentSeq).padStart(2, '0')}`;
      agents.push({
        node_id: `demo-node-${String(agentSeq).padStart(3, '0')}`,
        alias,
        department_id: dept.id,
        lifecycle_state: 'active',
      });
      // 状态分布：working 4/6 · idle 1/6 · error/blocked 各少量
      const mod = agentSeq % 6;
      const status = mod === 0 ? 'idle' : mod === 5 ? (agentSeq % 12 === 5 ? 'error' : 'blocked') : 'working';
      sessions.push({ alias, status });
    }
    members.push({ user_id, department_id: dept.id });
    people.push({
      user_id,
      username,
      display_name: username,
      role: 'member',
      department: { id: dept.id, name: dept.name },
      agents,
    });
  }

  // 无主 Agent：负责人点名要的是「6 部门 / 24 成员 / 60 Agent」，
  // 所以默认不放无主组（否则核心会显示 7 部门 · 64 Agent，与规格不符）。
  // 需要展示这个分组时把 SCALE.orphans 调大即可。
  const orphans: LegionAgentRef[] = [];
  for (let i = 0; i < SCALE.orphans; i += 1) {
    const alias = `orphan-${String(i + 1).padStart(2, '0')}`;
    orphans.push({ node_id: `demo-orphan-${i + 1}`, alias, department_id: null, lifecycle_state: 'active' });
    sessions.push({ alias, status: i % 2 === 0 ? 'idle' : 'working' });
  }

  return { people, orphans, departments, members, sessions };
}
