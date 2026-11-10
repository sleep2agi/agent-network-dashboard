import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_RADIUS, DEFAULT_ORG_VIEW, buildOrgScene, enclosingCircle, fitOrgView, focusView, hitOrg, layoutOrgLabels, makeProjector, orgStatus,
  packCircles, projectOrgScene, projectedBounds, relatedIds, searchOrg, type LabelRequest, type OrgScene,
} from './org-3d.ts';
import { buildPlazaDirectory } from './legion-directory.ts';
import type { PeopleResponse, DepartmentsResponse } from './legion-data.ts';

/** 与生产同量级：14 个部门（两级树）、9 个人、280 个有主 + 60 个无主 Agent。 */
function fixture() {
  const names = ['ANet', '通信', 'TMWork', 'TM知识库', 'TM门户', 'TM基建', 'OODA', 'TMAI', '设计', '测试', '运维', '数据', '客户端', '研究'];
  const departments = names.map((name, i) => ({ id: `d${i}`, name, parent_id: i === 0 ? null : i < 6 ? 'd0' : i < 10 ? 'd1' : i < 12 ? 'd2' : null, sort: i }));
  const counts = [96, 52, 40, 30, 22, 16, 12, 8, 4];
  const home = [0, 1, 1, 2, 2, 3, 6, 7, 1];
  const statuses = ['working', 'idle', 'blocked', 'error', 'offline'];
  let n = 0;
  const status = new Map<string, string>();
  const agent = (prefix: string, dept: string | null) => {
    const id = `n${n++}`;
    if (n % 5) status.set(id, statuses[n % statuses.length]);
    return { node_id: id, alias: `${prefix}-${n}`, department_id: dept };
  };
  const people = counts.map((c, i) => ({
    user_id: `u${i}`, username: `user${i}`, display_name: `成员${i}`, role: 'member',
    department: { id: `d${home[i]}`, name: names[home[i]] },
    agents: Array.from({ length: c }, (_, k) => agent(`成员${i}`, k % 9 === 4 ? `d${(i * 3 + k) % 14}` : `d${home[i]}`)),
  }));
  const data: PeopleResponse = {
    ok: true, total: people.length, people, has_more: false, agent_department_supported: true,
    agents_without_owner: Array.from({ length: 60 }, () => agent('野生', null)),
  };
  const hierarchy: DepartmentsResponse = { departments, members: people.map((p, i) => ({ user_id: p.user_id, department_id: `d${home[i]}` })) };
  return { platforms: buildPlazaDirectory(data, hierarchy).platforms, status };
}

function scene(): OrgScene {
  const f = fixture();
  return buildOrgScene(f.platforms, id => f.status.get(id));
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

test('status mapping keeps "no session" distinct from idle', () => {
  assert.equal(orgStatus(undefined), 'offline');
  assert.equal(orgStatus('offline'), 'offline');
  assert.equal(orgStatus('working'), 'working');
  assert.equal(orgStatus('blocked'), 'blocked');
  assert.equal(orgStatus('error'), 'error');
  assert.equal(orgStatus('idle'), 'idle');
  assert.equal(orgStatus('waiting'), 'idle');
});

test('production-sized org: every person, department and agent is placed exactly once', () => {
  const s = scene();
  assert.equal(s.totals.people, 9);
  assert.equal(s.totals.agents, 340);
  // 14 real departments + the synthetic 未归属 bucket for the 60 unowned agents.
  assert.equal(s.depts.length, 15);
  assert.equal(new Set(s.agents.map(a => a.id)).size, 340);
  assert.equal(Object.values(s.totals.counts).reduce((x, y) => x + y, 0), 340);
  const vincent = s.people.find(p => p.name === '成员0')!;
  assert.equal(vincent.agents, 96, 'person counts include agents placed in other departments');
});

test('department discs never overlap and child departments sit next to their parent', () => {
  const s = scene();
  for (const a of s.depts) for (const b of s.depts) {
    if (a === b) continue;
    assert(dist(a.center, b.center) >= a.radius + b.radius + 1, `${a.name} overlaps ${b.name}`);
  }
  const avgGap = (pred: (a: typeof s.depts[number], b: typeof s.depts[number]) => boolean) => {
    const gaps: number[] = [];
    for (const a of s.depts) for (const b of s.depts) if (a !== b && pred(a, b)) gaps.push(dist(a.center, b.center) - a.radius - b.radius);
    return gaps.reduce((x, y) => x + y, 0) / gaps.length;
  };
  assert(avgGap((a, b) => b.parentId === a.id) < avgGap((a, b) => b.parentId !== a.id && a.parentId !== b.id), 'children cluster around parents');
});

test('owner groups stay inside their department and agents never overlap', () => {
  const s = scene();
  for (const d of s.depts) {
    const groups = s.groups.filter(g => g.deptId === d.id);
    for (const g of groups) {
      assert(dist(g.center, d.center) + g.radius <= d.radius + 1e-6, `${g.label} escapes ${d.name}`);
      for (const h of groups) if (g !== h) assert(dist(g.center, h.center) >= g.radius + h.radius, `${g.label} overlaps ${h.label}`);
    }
  }
  const byGroup = new Map<string, typeof s.agents>();
  for (const a of s.agents) byGroup.set(a.groupId, [...(byGroup.get(a.groupId) ?? []), a]);
  for (const [id, agents] of byGroup) {
    const g = s.groups.find(x => x.id === id)!;
    for (const a of agents) assert(dist(a.pos, g.center) <= g.radius, `${a.name} escapes its owner group`);
    for (let i = 0; i < agents.length; i++) for (let j = i + 1; j < agents.length; j++) {
      assert(dist(agents[i].pos, agents[j].pos) >= AGENT_RADIUS * 2, `${agents[i].name} overlaps ${agents[j].name}`);
    }
  }
  for (const p of s.people) {
    const g = s.groups.find(x => x.ownerId === p.id && x.deptId === p.deptId)!;
    assert(dist(p.pos, g.center) < 1e-9 && p.pos.y > p.base.y, 'person floats directly above its own group');
  }
});

test('layout is deterministic', () => {
  assert.deepEqual(scene(), scene());
});

test('empty input and departments without anyone still render', () => {
  const empty = buildOrgScene([]);
  assert.equal(empty.depts.length, 0);
  assert.equal(empty.agents.length, 0);
  const lone = buildOrgScene([{ id: 'dept:x', name: '空部门', parentId: null, people: [], agents: [] }]);
  assert.equal(lone.depts.length, 1);
  assert(lone.depts[0].radius > 0);
});

test('packCircles keeps the requested gap', () => {
  const placed = packCircles([5, 3, 3, 2, 1, 1, 1, 4].map(r => ({ r })), 0.5);
  for (const a of placed) for (const b of placed) if (a !== b) assert(Math.hypot(a.x - b.x, a.z - b.z) >= a.r + b.r + 0.5 - 1e-9);
});

const SAFE = { top: 36, right: 24, bottom: 64, left: 24 };

test('fitOrgView frames the whole org inside the safe area on desktop and phone', () => {
  const s = scene();
  for (const size of [{ width: 1100, height: 760 }, { width: 390, height: 600 }]) {
    const view = fitOrgView(s, DEFAULT_ORG_VIEW, size, SAFE);
    const b = projectedBounds(s, makeProjector(s, view, size, SAFE))!;
    assert(b.x0 >= SAFE.left - 2 && b.x1 <= size.width - SAFE.right + 2, `x out of frame at ${size.width}`);
    assert(b.y0 >= SAFE.top - 2 && b.y1 <= size.height - SAFE.bottom + 2, `y out of frame at ${size.width}`);
    const fillW = (b.x1 - b.x0) / (size.width - SAFE.left - SAFE.right);
    const fillH = (b.y1 - b.y0) / (size.height - SAFE.top - SAFE.bottom);
    assert(Math.max(fillW, fillH) > 0.85, `org should fill the frame at ${size.width} (got ${fillW.toFixed(2)}×${fillH.toFixed(2)})`);
  }
});

function labelRequests(s: OrgScene, size: { width: number; height: number }) {
  const view = fitOrgView(s, DEFAULT_ORG_VIEW, size, SAFE);
  const proj = makeProjector(s, view, size, SAFE);
  const projected = projectOrgScene(s, proj);
  const reqs: LabelRequest[] = [];
  for (const d of projected.depts) {
    if (d.body.kind !== 'dept') continue;
    reqs.push({ id: d.body.id, body: d.body, x: d.x, y: d.y - d.r * Math.sin(view.pitch), r: 2, w: d.body.name.length * 12 + 16, h: 34, priority: 1000 + d.body.agents, required: true });
  }
  for (const n of projected.nodes) {
    if (n.body.kind !== 'person') continue;
    reqs.push({ id: n.body.id, body: n.body, x: n.x, y: n.y, r: n.r, w: n.body.name.length * 12 + 40, h: 20, priority: 900, required: true });
  }
  return { reqs, projected, view };
}

test('every department and person label is readable: placed, in bounds, no overlaps', () => {
  const s = scene();
  const size = { width: 1100, height: 760 };
  const { reqs } = labelRequests(s, size);
  const labels = layoutOrgLabels(reqs, size);
  assert.equal(labels.length, 15 + 9);
  assert.equal(labels.filter(l => l.forced).length, 0, 'no label had to be stacked');
  for (const a of labels) {
    assert(a.x >= 0 && a.y >= 0 && a.x + a.w <= size.width && a.y + a.h <= size.height);
    for (const b of labels) if (a !== b) assert(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `${a.id} overlaps ${b.id}`);
  }
});

test('optional labels are dropped rather than stacked', () => {
  const s = scene();
  const agent = s.agents[0];
  const reqs: LabelRequest[] = Array.from({ length: 50 }, (_, i) => ({ id: `a${i}`, body: agent, x: 100, y: 100, r: 3, w: 80, h: 16, priority: 1, required: false }));
  const labels = layoutOrgLabels(reqs, { width: 400, height: 300 });
  assert(labels.length < 50 && labels.length > 0);
  assert(labels.every(l => !l.forced));
});

test('hit testing resolves people, agents and department discs, and misses empty space', () => {
  const s = scene();
  const size = { width: 1100, height: 760 };
  const { projected, view } = labelRequests(s, size);
  const person = projected.nodes.find(n => n.body.kind === 'person')!;
  assert.equal(hitOrg(projected, person.x, person.y, view.pitch)?.id, person.body.id);
  const front = projected.nodes[projected.nodes.length - 1];
  assert.equal(hitOrg(projected, front.x, front.y, view.pitch)?.id, front.body.id, 'front-most node wins');
  const emptyDept = projected.depts.find(d => d.body.kind === 'dept' && d.body.agents === 0 && d.body.people === 0);
  if (emptyDept) assert.equal(hitOrg(projected, emptyDept.x, emptyDept.y, view.pitch)?.id, emptyDept.body.id);
  assert.equal(hitOrg(projected, 2, 2, view.pitch), null);
});

test('search ranks departments, then people, then agents', () => {
  const s = scene();
  const r = searchOrg(s, 'TM');
  assert.equal(r[0].kind, 'dept');
  assert.deepEqual(searchOrg(s, '   '), []);
  assert.equal(searchOrg(s, '成员3')[0].kind, 'person');
  assert.equal(searchOrg(s, 'n12')[0]?.kind, 'agent', 'node id is searchable');
});

test('selecting a person highlights all their agents across departments', () => {
  const s = scene();
  const p = s.people.find(x => x.name === '成员0')!;
  const ids = relatedIds(s, p)!;
  const owned = s.agents.filter(a => a.ownerId === p.id);
  assert.equal(owned.length, 96);
  assert(owned.every(a => ids.has(a.id)));
  assert(new Set(owned.map(a => a.deptId)).size > 1, 'fixture has cross-department agents');
  assert.equal(relatedIds(s, null), null);
});

test('focusing a department zooms in further than the overview', () => {
  const s = scene();
  const small = s.depts.find(d => d.name === 'OODA')!;
  const v = focusView(s, small, DEFAULT_ORG_VIEW);
  assert(v.zoom > DEFAULT_ORG_VIEW.zoom);
  assert.deepEqual(v.target, { x: small.center.x, z: small.center.z });
});

test('enclosingCircle is tight and contains every circle', () => {
  const placed = packCircles([3.7, 3.3, 1.1, 1.1].map(r => ({ r })), 0.55);
  const c = enclosingCircle(placed);
  for (const p of placed) assert(Math.hypot(p.x - c.x, p.z - c.z) + p.r <= c.r + 1e-9);
  const naive = placed.reduce((m, p) => Math.max(m, Math.hypot(p.x, p.z) + p.r), 0);
  assert(c.r <= naive + 1e-9, 'never looser than measuring from the first circle');
  // Any enclosing circle is at least half the widest pair span: within 2% of that bound = near-optimal.
  let lower = 0;
  for (const a of placed) for (const b of placed) lower = Math.max(lower, (Math.hypot(a.x - b.x, a.z - b.z) + a.r + b.r) / 2);
  assert(c.r <= lower * 1.02, `radius ${c.r} vs lower bound ${lower}`);
});
