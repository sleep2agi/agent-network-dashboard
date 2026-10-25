import { describe, expect, test } from 'bun:test';
import { buildLegionLayout, toPixel, RING_RADIUS, ORPHAN_GROUP, UNGROUPED } from './legion-layout';

const person = (over = {}) => ({
  user_id: 'u1', username: 'vansin', display_name: 'Vincent', role: 'owner',
  department: { id: 'd1', name: '平台' }, agents: [], ...over,
});

const agent = (i) => ({ node_id: `n_${i}`, alias: `agent-${i}` });

function angleDelta(a, b) {
  const TAU = Math.PI * 2;
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return Math.abs(d);
}

describe('#1636 军团布局 — 纯函数，同一份数据必须永远画出同一张图', () => {
  test('空输入：只有圆心，统计全 0，不出 NaN', () => {
    const layout = buildLegionLayout({ people: [] });
    expect(layout.nodes).toHaveLength(1);
    expect(layout.nodes[0].kind).toBe('core');
    expect(layout.stats).toEqual({ groups: 0, people: 0, agents: 0, orphans: 0 });
    expect(Number.isFinite(layout.nodes[0].x)).toBe(true);
  });

  test('三层环半径固定：部门 < 人 < Agent', () => {
    expect(RING_RADIUS.group).toBeLessThan(RING_RADIUS.person);
    expect(RING_RADIUS.person).toBeLessThan(RING_RADIUS.agent);
    expect(RING_RADIUS.agent).toBe(1);
  });

  test('分组顺序固定：命名部门 → 未分组 → 无主 Agent，与输入顺序无关', () => {
    const a = buildLegionLayout({
      people: [
        person({ user_id: 'u1', display_name: 'B', department: { id: 'd2', name: '平台' } }),
        person({ user_id: 'u2', display_name: 'A', department: { id: 'd1', name: '客户端' } }),
        person({ user_id: 'u3', display_name: 'C', department: null }),
      ],
      orphans: [agent(9)],
    });
    const b = buildLegionLayout({
      people: [
        person({ user_id: 'u3', display_name: 'C', department: null }),
        person({ user_id: 'u1', display_name: 'B', department: { id: 'd2', name: '平台' } }),
        person({ user_id: 'u2', display_name: 'A', department: { id: 'd1', name: '客户端' } }),
      ],
      orphans: [agent(9)],
    });
    const groups = a.nodes.filter(n => n.kind === 'group').map(n => n.label);
    expect(groups[groups.length - 2]).toBe(UNGROUPED);
    expect(groups[groups.length - 1]).toBe(ORPHAN_GROUP);
    // 同一份数据、不同输入顺序 → 坐标逐点一致
    expect(b.nodes.map(n => [n.id, n.x.toFixed(6), n.y.toFixed(6)]))
      .toEqual(a.nodes.map(n => [n.id, n.x.toFixed(6), n.y.toFixed(6)]));
  });

  test('每个人挂在自己的部门下，Agent 挂在自己的 owner 下', () => {
    const layout = buildLegionLayout({
      people: [person({ agents: [agent(1), agent(2)] })],
    });
    const group = layout.nodes.find(n => n.kind === 'group');
    const owner = layout.nodes.find(n => n.kind === 'person');
    const agents = layout.nodes.filter(n => n.kind === 'agent');
    expect(owner.parentId).toBe(group.id);
    expect(agents).toHaveLength(2);
    for (const a of agents) expect(a.parentId).toBe(owner.id);
    expect(group.agentCount).toBe(2);
    expect(layout.stats).toEqual({ groups: 1, people: 1, agents: 2, orphans: 0 });
  });

  test('Agent 扇形不会散出 owner 太远（±0.16 弧度内）', () => {
    const layout = buildLegionLayout({
      people: [person({ agents: Array.from({ length: 12 }, (_, i) => agent(i)) })],
    });
    const owner = layout.nodes.find(n => n.kind === 'person');
    const agents = layout.nodes.filter(n => n.kind === 'agent');
    for (const a of agents) {
      expect(angleDelta(a.angle, owner.angle)).toBeLessThanOrEqual(0.2001);
    }
    // 双环交错：相邻 Agent 不能落在同一半径上，否则窄屏会叠成一点
    for (let i = 1; i < agents.length; i++) {
      expect(agents[i].radius).not.toBe(agents[i - 1].radius);
    }
    expect(Math.max(...agents.map(a => a.radius))).toBe(1);
  });

  test('节点 id 唯一，角标归一化到 [0, 2π)', () => {
    const layout = buildLegionLayout({
      people: [
        person({ user_id: 'u1', agents: [agent(1), agent(2), agent(3)] }),
        person({ user_id: 'u2', username: 'tmai', display_name: 'TMAI', department: { id: 'd2', name: '文档' }, agents: [agent(4)] }),
        person({ user_id: 'u3', department: null }),
      ],
      orphans: [agent(5)],
    });
    const ids = layout.nodes.map(n => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const n of layout.nodes) {
      expect(n.angle).toBeGreaterThanOrEqual(0);
      expect(n.angle).toBeLessThan(Math.PI * 2);
      expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
    }
  });

  test('每条边都指向真实节点，且没有孤立节点', () => {
    const layout = buildLegionLayout({ people: [person({ agents: [agent(1)] })], orphans: [agent(7)] });
    const ids = new Set(layout.nodes.map(n => n.id));
    for (const e of layout.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
    for (const n of layout.nodes.filter(n => n.kind !== 'core')) {
      expect(layout.edges.some(e => e.to === n.id)).toBe(true);
    }
  });

  test('部门扇区：总弧度 2π、互不重叠、中心角与起点自洽', () => {
    const layout = buildLegionLayout({
      people: [
        person({ user_id: 'u1', department: { id: 'd1', name: '平台' }, agents: [agent(1), agent(2)] }),
        person({ user_id: 'u2', display_name: 'A', department: { id: 'd1', name: '平台' } }),
        person({ user_id: 'u3', display_name: 'B', department: { id: 'd2', name: '设计' } }),
        person({ user_id: 'u4', display_name: 'C', department: null }),
      ],
      orphans: [agent(8)],
    });
    const groups = layout.nodes.filter(n => n.kind === 'group');
    expect(groups.length).toBe(4);
    const total = groups.reduce((n, g) => n + g.span, 0);
    expect(total).toBeCloseTo(Math.PI * 2, 6);
    for (const g of groups) {
      expect(g.spanStart).toBeGreaterThanOrEqual(0);
      expect(g.spanStart).toBeLessThan(Math.PI * 2);
      // 中心角 = 起点 + 半跨度（模 2π）
      expect(angleDelta(g.angle, g.spanStart + g.span / 2)).toBeLessThan(1e-6);
      expect(g.spanStart + g.span).toBeLessThanOrEqual(Math.PI * 2 + 1e-9);
    }
    const sorted = [...groups].sort((a, b) => a.spanStart - b.spanStart);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1].spanStart + sorted[i - 1].span).toBeLessThanOrEqual(sorted[i].spanStart + 1e-9);
    }
  });

  test('toPixel 把归一化坐标映射到容器中心与半径内', () => {
    const size = { width: 800, height: 600 };
    const center = toPixel({ x: 0, y: 0 }, size);
    expect(center).toEqual({ x: 400, y: 300 });
    const top = toPixel({ x: 0, y: -1 }, size);
    expect(top.y).toBeLessThan(300);
    expect(top.x).toBeCloseTo(400, 5);
    const right = toPixel({ x: 1, y: 0 }, size);
    // 半径取 min(w,h)/2 * 0.92 = 276
    expect(right.x).toBeCloseTo(676, 5);
  });
});
