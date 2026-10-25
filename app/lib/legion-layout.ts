/**
 * 军团（组织架构图）布局 —— #1636 / owner 2026-10-25 指令。
 *
 * 客户端目前只有「部门/成员管理」，没有可对齐的组织图，所以这张图是
 * Dashboard 单独做的：把 Hub 通讯录投影（人 → 部门 → 名下 Agent）画成
 * 三层同心环。布局必须是**纯函数**，理由和 requirements-paging 一样：
 * 角度分配、分组顺序、Agent 扇形这些只要错一点，画出来就是一堆重叠的圆，
 * 而「截图里看着还行」不能当断言。所以坐标在这里算，行为在
 * legion-layout.test.mjs 里钉住，组件只负责把它们画出来。
 *
 * 坐标约定：以 (0,0) 为圆心、半径 1 为最外环的归一化平面；
 * angle 从 12 点方向起顺时针（0 = 正上方）。
 *   x = r * sin(angle)
 *   y = -r * cos(angle)
 */

export type LegionNodeKind = 'core' | 'group' | 'person' | 'agent';

export interface LegionPerson {
  user_id: string;
  username: string;
  display_name: string;
  role: string;
  department: { id: string; name: string } | null;
  agents: { node_id: string; alias: string }[];
}

export interface LegionAgentRef {
  node_id: string;
  alias: string;
}

export interface LegionInput {
  people: LegionPerson[];
  /** 不属于任何人的 Agent（Hub 的 agents_without_owner）。 */
  orphans?: LegionAgentRef[];
  /** 圆心标题，默认「军团」。 */
  title?: string;
}

export interface LegionNode {
  id: string;
  kind: LegionNodeKind;
  label: string;
  sublabel?: string;
  /** 0 圆心 / 1 部门 / 2 人 / 3 Agent */
  ring: 0 | 1 | 2 | 3;
  angle: number;
  radius: number;
  x: number;
  y: number;
  parentId: string | null;
  /** 该人/该部门名下 Agent 数（Agent 节点为 0）。 */
  agentCount: number;
  /** 排序键，保证同一份输入永远得到同一张图。 */
  order: number;
  /** 仅部门节点：该部门在圆环上占的弧度与起止（顺时针，0 = 12 点）。 */
  span?: number;
  spanStart?: number;
}

export interface LegionEdge {
  id: string;
  from: string;
  to: string;
}

export interface LegionLayout {
  nodes: LegionNode[];
  edges: LegionEdge[];
  stats: { groups: number; people: number; agents: number; orphans: number };
  /** 每个环的归一化半径，供组件画参考圆。 */
  rings: { ring: 1 | 2 | 3; radius: number }[];
}

export const UNGROUPED = '未分组';
export const ORPHAN_GROUP = '无主 Agent';

/** 环半径：部门贴近圆心，人第二层，Agent 在最外。 */
export const RING_RADIUS = { core: 0, group: 0.5, person: 0.76, agent: 1 } as const;

/** 一个部门至少占这么多弧度，避免 1 人部门被挤成一条线。 */
const MIN_GROUP_SPAN = 0.18;
/** Agent 扇形：相邻 Agent 的角度间隔与最大半宽。 */
const AGENT_STEP = 0.075;
const AGENT_MAX_HALF_WIDTH = 0.2;
/** 同一 owner 的 Agent 交替落在两个半径上：纯角度摊开在窄屏仍会互相压住。 */
const AGENT_RING_ALT = 0.9;

const TAU = Math.PI * 2;

function polar(radius: number, angle: number): { x: number; y: number } {
  return { x: radius * Math.sin(angle), y: -radius * Math.cos(angle) };
}

/** 角度按 12 点起顺时针增长；排序与比较都走这里，避免 -π/π 处的跳变。 */
function normalize(angle: number): number {
  const a = angle % TAU;
  return a < 0 ? a + TAU : a;
}

interface Group {
  id: string;
  label: string;
  people: LegionPerson[];
  orphans: LegionAgentRef[];
  weight: number;
}

function groupKey(person: LegionPerson): { id: string; label: string } {
  return person.department
    ? { id: `dept:${person.department.id}`, label: person.department.name }
    : { id: 'dept:none', label: UNGROUPED };
}

/**
 * 按部门分组。顺序固定：有名字的部门按名称排，未分组其次，无主 Agent 最后。
 * 输入顺序不得影响输出（否则同一份数据两次刷新图形会跳）。
 */
function buildGroups(input: LegionInput): Group[] {
  const map = new Map<string, Group>();
  for (const person of input.people) {
    const { id, label } = groupKey(person);
    const group = map.get(id) ?? { id, label, people: [], orphans: [], weight: 0 };
    group.people.push(person);
    map.set(id, group);
  }
  const orphans = input.orphans ?? [];
  if (orphans.length > 0) {
    map.set('orphans', { id: 'orphans', label: ORPHAN_GROUP, people: [], orphans, weight: 0 });
  }
  const groups = [...map.values()];
  groups.sort((a, b) => {
    const rank = (g: Group) => (g.id === 'orphans' ? 2 : g.id === 'dept:none' ? 1 : 0);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return a.label.localeCompare(b.label, 'zh-Hans-CN');
  });
  for (const group of groups) {
    group.people.sort((a, b) =>
      (a.display_name || a.username).localeCompare(b.display_name || b.username, 'zh-Hans-CN')
      || a.user_id.localeCompare(b.user_id));
    // 权重：一个人算 1，无主 Agent 每个算 0.5（它们只占最外环，不该抢人的角度）。
    group.weight = Math.max(group.people.length + group.orphans.length * 0.5, 1);
  }
  return groups;
}

export function buildLegionLayout(input: LegionInput): LegionLayout {
  const groups = buildGroups(input);
  const nodes: LegionNode[] = [];
  const edges: LegionEdge[] = [];
  const title = input.title ?? '军团';
  const peopleCount = input.people.length;
  const agentCount = input.people.reduce((n, p) => n + p.agents.length, 0);
  const orphanCount = input.orphans?.length ?? 0;

  nodes.push({
    id: 'core', kind: 'core', label: title, ring: 0, angle: 0, radius: 0,
    ...polar(0, 0), parentId: null, agentCount, order: -1,
  });

  const totalWeight = groups.reduce((n, g) => n + g.weight, 0) || 1;
  let cursor = 0;            // 顺时针角度游标
  let order = 0;             // 稳定排序键

  groups.forEach((group) => {
    const weighted = (group.weight / totalWeight) * TAU;
    const span = Math.max(weighted, group.people.length > 0 ? MIN_GROUP_SPAN : MIN_GROUP_SPAN / 2);
    const groupAngle = cursor + span / 2;
    const groupId = `group:${group.id}`;
    const groupAgentCount = group.people.reduce((n, p) => n + p.agents.length, 0) + group.orphans.length;

    nodes.push({
      id: groupId, kind: 'group', label: group.label,
      sublabel: group.people.length > 0 ? `${group.people.length} 人 · ${groupAgentCount} Agent` : `${groupAgentCount} Agent`,
      ring: 1, angle: normalize(groupAngle), radius: RING_RADIUS.group,
      ...polar(RING_RADIUS.group, groupAngle),
      parentId: 'core', agentCount: groupAgentCount, order: order++,
      span, spanStart: normalize(cursor),
    });
    edges.push({ id: `core->${groupId}`, from: 'core', to: groupId });

    // 人的槽位：部门扇区内部均分；只有一个成员时落在扇区中线。
    const slots = Math.max(group.people.length, 1);
    const inner = span * 0.72;                 // 留出扇区边缘空隙（相邻部门的人不能贴在一起）
    group.people.forEach((person, index) => {
      const angle = slots === 1
        ? groupAngle
        : groupAngle - inner / 2 + (inner * index) / (slots - 1);
      const personId = `person:${person.user_id}`;
      nodes.push({
        id: personId, kind: 'person', label: person.display_name || person.username,
        sublabel: `@${person.username}`, ring: 2, angle: normalize(angle), radius: RING_RADIUS.person,
        ...polar(RING_RADIUS.person, angle),
        parentId: groupId, agentCount: person.agents.length, order: order++,
      });
      edges.push({ id: `${groupId}->${personId}`, from: groupId, to: personId });

      // 名下 Agent：以人的角度为中心的扇形，最多铺满 AGENT_MAX_HALF_WIDTH。
      const count = person.agents.length;
      person.agents
        .slice()
        .sort((a, b) => a.alias.localeCompare(b.alias, 'zh-Hans-CN') || a.node_id.localeCompare(b.node_id))
        .forEach((agent, agentIndex) => {
          const half = Math.min(((count - 1) / 2) * AGENT_STEP, AGENT_MAX_HALF_WIDTH);
          const offset = count === 1 ? 0 : -half + (2 * half * agentIndex) / (count - 1);
          const agentAngle = angle + offset;
          const agentId = `agent:${agent.node_id}`;
          const agentRadius = RING_RADIUS.agent * (agentIndex % 2 === 0 ? 1 : AGENT_RING_ALT);
          nodes.push({
            id: agentId, kind: 'agent', label: agent.alias, ring: 3,
            angle: normalize(agentAngle), radius: agentRadius,
            ...polar(agentRadius, agentAngle),
            parentId: personId, agentCount: 0, order: order++,
          });
          edges.push({ id: `${personId}->${agentId}`, from: personId, to: agentId });
        });
    });

    // 无主 Agent：直接挂在部门环上（它们没有 owner，但确实属于这个网络）。
    group.orphans
      .slice()
      .sort((a, b) => a.alias.localeCompare(b.alias, 'zh-Hans-CN') || a.node_id.localeCompare(b.node_id))
      .forEach((agent, index) => {
        const offset = group.orphans.length === 1
          ? 0
          : -Math.min(((group.orphans.length - 1) / 2) * AGENT_STEP, AGENT_MAX_HALF_WIDTH)
            + (2 * Math.min(((group.orphans.length - 1) / 2) * AGENT_STEP, AGENT_MAX_HALF_WIDTH) * index) / (group.orphans.length - 1);
        const agentAngle = groupAngle + offset;
        const agentId = `agent:${agent.node_id}`;
        const agentRadius = RING_RADIUS.agent * (index % 2 === 0 ? 1 : AGENT_RING_ALT);
        nodes.push({
          id: agentId, kind: 'agent', label: agent.alias, ring: 3,
          angle: normalize(agentAngle), radius: agentRadius,
          ...polar(agentRadius, agentAngle),
          parentId: groupId, agentCount: 0, order: order++,
        });
        edges.push({ id: `${groupId}->${agentId}`, from: groupId, to: agentId });
      });

    cursor += span;
  });

  return {
    nodes,
    edges,
    stats: { groups: groups.length, people: peopleCount, agents: agentCount, orphans: orphanCount },
    rings: [
      { ring: 1, radius: RING_RADIUS.group },
      { ring: 2, radius: RING_RADIUS.person },
      { ring: 3, radius: RING_RADIUS.agent },
    ],
  };
}

/**
 * 归一化坐标 → 像素。组件在 ResizeObserver 里拿到容器尺寸后调用；
 * radiusFactor 留出标签外沿的空白（0.92 意味着最外环贴到 92% 半径）。
 */
export function toPixel(
  node: { x: number; y: number },
  size: { width: number; height: number },
  radiusFactor = 0.92,
): { x: number; y: number } {
  const radius = (Math.min(size.width, size.height) / 2) * radiusFactor;
  return {
    x: size.width / 2 + node.x * radius,
    y: size.height / 2 + node.y * radius,
  };
}
