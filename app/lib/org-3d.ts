/**
 * 组织 3D（`/legion/org`）的纯函数层：部门 → 成员 → Agent 的「星团」布局。
 *
 * 与 `/legion/3d` 的同心环不同，这里按部门聚团：
 *   - 每个部门是地面上的一块圆盘，盘与盘之间用圆打包保证**互不重叠**；
 *     子部门以父部门为锚点向外找位置，所以编制关系在空间上是挨着的；
 *   - 盘内按负责人分小团（同一个人的 Agent 聚在一起），小团同样打包不重叠；
 *   - 小团里的 Agent 用向日葵排布（等面积、无重叠），中间略微隆起成小丘，
 *     负责人悬浮在小丘正上方。
 *
 * 坐标：右手系、y 向上，地面 y = 0；单位 1 ≈ 相邻 Agent 的间距。
 * 一切确定性：同一份编制永远得到同一张图（不引入随机数）。
 */

import { projectPoint, type Vec3 } from './legion-3d';
import type { LegionPerson } from './legion-layout';
import type { PlazaAgent, PlazaDepartment } from './legion-directory';

export type OrgStatus = 'working' | 'idle' | 'blocked' | 'error' | 'offline';
export const ORG_STATUSES: readonly OrgStatus[] = ['working', 'idle', 'blocked', 'error', 'offline'];
export const ORG_STATUS_LABEL: Record<OrgStatus, string> = {
  working: '运行中', idle: '空闲', blocked: '阻塞', error: '错误', offline: '离线/未上报',
};

/** Hub 的原始 session 状态 → 五档图例。没有 session 视为未上报，不是空闲。 */
export function orgStatus(raw?: string | null): OrgStatus {
  if (!raw || raw === 'offline') return 'offline';
  if (raw === 'working' || raw === 'blocked' || raw === 'error') return raw;
  return 'idle';
}

export type StatusCounts = Record<OrgStatus, number>;
const emptyCounts = (): StatusCounts => ({ working: 0, idle: 0, blocked: 0, error: 0, offline: 0 });

/** 相邻 Agent 在向日葵排布里的半径系数：最近邻间距 ≈ 1。 */
const SUNFLOWER_C = 0.62;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
export const AGENT_RADIUS = 0.34;
export const PERSON_LIFT = 1.6;
const GROUP_GAP = 0.55;
const DEPT_PAD = 0.8;
const DEPT_GAP = 2.4;
const EMPTY_DEPT_RADIUS = 1.8;

export interface OrgDept {
  kind: 'dept';
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  center: Vec3;
  radius: number;
  people: number;
  agents: number;
  counts: StatusCounts;
  unknown: boolean;
}

export interface OrgPerson {
  kind: 'person';
  id: string;
  name: string;
  deptId: string;
  person: LegionPerson;
  pos: Vec3;
  /** 小丘的地面中心（画悬浮立柱用）。 */
  base: Vec3;
  /** 名下 Agent 总数（跨部门）。 */
  agents: number;
  counts: StatusCounts;
}

export interface OrgAgent {
  kind: 'agent';
  id: string;
  name: string;
  deptId: string;
  groupId: string;
  ownerId: string | null;
  agent: PlazaAgent;
  status: OrgStatus;
  pos: Vec3;
}

export interface OrgGroup {
  id: string;
  deptId: string;
  ownerId: string | null;
  label: string;
  center: Vec3;
  radius: number;
}

export interface OrgScene {
  depts: OrgDept[];
  people: OrgPerson[];
  agents: OrgAgent[];
  groups: OrgGroup[];
  /** 场景外接半径（从原点算）。 */
  extent: number;
  totals: { depts: number; people: number; agents: number; counts: StatusCounts };
}

export type OrgBody = OrgDept | OrgPerson | OrgAgent;

interface Circle { r: number; anchor?: { x: number; z: number } }
interface Placed { x: number; z: number; r: number }

/**
 * 贪心圆打包：按输入顺序逐个放；每个圆从锚点（缺省为原点）沿同心环向外找，
 * 第一圈能放下的候选里取离原点最近的那个。结果保证任意两圆间距 ≥ gap。
 */
export function packCircles(items: readonly Circle[], gap: number, step = 0.4, existing: readonly Placed[] = []): Placed[] {
  const placed: Placed[] = [...existing];
  for (const item of items) {
    const a = item.anchor ?? { x: 0, z: 0 };
    const fits = (x: number, z: number) => placed.every(p => Math.hypot(p.x - x, p.z - z) >= p.r + item.r + gap - 1e-9);
    if (fits(a.x, a.z)) { placed.push({ x: a.x, z: a.z, r: item.r }); continue; }
    let done = false;
    for (let ring = 1; !done && ring < 4000; ring++) {
      const rr = ring * step;
      const n = Math.max(12, Math.ceil((2 * Math.PI * rr) / step));
      let best: { x: number; z: number; d: number } | null = null;
      for (let k = 0; k < n; k++) {
        const t = (k / n) * Math.PI * 2 + ring * 0.37;
        const x = a.x + rr * Math.cos(t);
        const z = a.z + rr * Math.sin(t);
        if (!fits(x, z)) continue;
        const d = x * x + z * z;
        if (!best || d < best.d) best = { x, z, d };
      }
      if (best) { placed.push({ x: best.x, z: best.z, r: item.r }); done = true; }
    }
    if (!done) throw new Error('packCircles: no room');
  }
  return placed.slice(existing.length);
}

/** 近似最小外接圆（Bădoiu–Clarkson 迭代：每步向最远的圆边挪一点）。 */
export function enclosingCircle(placed: readonly Placed[]): Placed {
  if (!placed.length) return { x: 0, z: 0, r: 0 };
  let x = placed.reduce((s, p) => s + p.x, 0) / placed.length;
  let z = placed.reduce((s, p) => s + p.z, 0) / placed.length;
  const far = () => {
    let best = placed[0], d = -1;
    for (const p of placed) { const e = Math.hypot(p.x - x, p.z - z) + p.r; if (e > d) { d = e; best = p; } }
    return { p: best, d };
  };
  for (let i = 1; i <= 300; i++) {
    const { p } = far();
    const len = Math.hypot(p.x - x, p.z - z) || 1;
    const tx = p.x + ((p.x - x) / len) * p.r, tz = p.z + ((p.z - z) / len) * p.r;
    x += (tx - x) / (i + 1);
    z += (tz - z) / (i + 1);
  }
  return { x, z, r: far().d };
}

function personName(p: LegionPerson): string {
  return p.display_name || p.username;
}

function sunflower(k: number): { x: number; z: number; r: number } {
  const r = SUNFLOWER_C * Math.sqrt(k + 0.5);
  const t = k * GOLDEN;
  return { x: r * Math.cos(t), z: r * Math.sin(t), r };
}

function groupRadius(n: number): number {
  return n === 0 ? 0.8 : SUNFLOWER_C * Math.sqrt(n) + 0.45;
}

/** 小丘高度：中心高、边缘贴地，让每个负责人的 Agent 团在斜视角下有体积。 */
function domeHeight(r: number, radius: number): number {
  const t = Math.min(1, r / Math.max(radius, 1e-6));
  return 0.18 + Math.min(1.4, radius * 0.32) * (1 - t * t);
}

/**
 * 编制（`buildPlazaDirectory` 的 platforms）+ 状态 → 3D 场景。
 * `statusOf` 按 node_id 查状态（同名老记录不能借用别人的 session）。
 */
export function buildOrgScene(
  platforms: readonly PlazaDepartment[],
  statusOf: (nodeId: string) => string | null | undefined = () => null,
): OrgScene {
  const owners = new Map<string, { id: string; person: LegionPerson }>();
  for (const d of platforms) for (const p of d.people) owners.set(personName(p), { id: `person:${p.user_id}`, person: p });

  const byId = new Map(platforms.map(d => [d.id, d]));
  const depthOf = (d: PlazaDepartment) => {
    let depth = 1;
    const seen = new Set([d.id]);
    let cur = d.parentId ? byId.get(d.parentId) : undefined;
    while (cur && !seen.has(cur.id)) { depth++; seen.add(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
    return depth;
  };

  interface LocalGroup { id: string; ownerId: string | null; label: string; person?: LegionPerson; agents: PlazaAgent[]; r: number; x: number; z: number }
  const local = platforms.map(d => {
    const groups = new Map<string, LocalGroup>();
    for (const p of d.people) {
      const id = `group:${d.id}:person:${p.user_id}`;
      groups.set(`person:${p.user_id}`, { id, ownerId: `person:${p.user_id}`, label: personName(p), person: p, agents: [], r: 0, x: 0, z: 0 });
    }
    for (const a of d.agents) {
      const owner = a.owner ? owners.get(a.owner) : undefined;
      const key = owner ? owner.id : a.owner ? `owner:${a.owner}` : 'none';
      if (!groups.has(key)) {
        groups.set(key, { id: `group:${d.id}:${key}`, ownerId: owner?.id ?? null, label: a.owner ? `${a.owner} 名下` : '无负责人', agents: [], r: 0, x: 0, z: 0 });
      }
      groups.get(key)!.agents.push(a);
    }
    const list = [...groups.values()].sort((g, h) =>
      Number(!!h.person) - Number(!!g.person) || h.agents.length - g.agents.length || g.label.localeCompare(h.label));
    for (const g of list) g.r = groupRadius(g.agents.length);
    const raw = packCircles(list, GROUP_GAP, 0.25);
    const hull = enclosingCircle(raw);
    list.forEach((g, i) => { g.x = raw[i].x - hull.x; g.z = raw[i].z - hull.z; });
    const radius = list.length ? hull.r + DEPT_PAD : EMPTY_DEPT_RADIUS;
    return { dept: d, groups: list, radius, depth: depthOf(d) };
  });

  // 外层：先放顶层（大的居中），再按层级放子部门，子部门以父部门为锚点。
  const order = local.map((_, i) => i).sort((i, j) =>
    local[i].depth - local[j].depth || local[j].radius - local[i].radius || i - j);
  const centers = new Map<string, { x: number; z: number }>();
  const placedDepts = new Map<number, Placed>();
  const packedSoFar: Placed[] = [];
  for (const i of order) {
    const parent = local[i].dept.parentId ? centers.get(local[i].dept.parentId!) : undefined;
    const [spot] = packCircles([{ r: local[i].radius, anchor: parent }], DEPT_GAP, 0.6, packedSoFar);
    packedSoFar.push(spot);
    placedDepts.set(i, spot);
    centers.set(local[i].dept.id, { x: spot.x, z: spot.z });
  }
  // 整体平移到外接圆圆心，避免取景时偏向一侧。
  const { x: mx, z: mz } = enclosingCircle([...placedDepts.values()]);

  const depts: OrgDept[] = [];
  const people: OrgPerson[] = [];
  const agents: OrgAgent[] = [];
  const groups: OrgGroup[] = [];
  const totals = { depts: platforms.length, people: 0, agents: 0, counts: emptyCounts() };
  const personCounts = new Map<string, StatusCounts>();
  const personAgents = new Map<string, number>();

  local.forEach((entry, i) => {
    const spot = placedDepts.get(i)!;
    const cx = spot.x - mx;
    const cz = spot.z - mz;
    const counts = emptyCounts();
    for (const g of entry.groups) {
      const gx = cx + g.x;
      const gz = cz + g.z;
      groups.push({ id: g.id, deptId: entry.dept.id, ownerId: g.ownerId, label: g.label, center: { x: gx, y: 0, z: gz }, radius: g.r });
      g.agents.forEach((a, k) => {
        const s = sunflower(k);
        const status = orgStatus(statusOf(a.node_id));
        counts[status]++;
        if (g.ownerId) {
          const pc = personCounts.get(g.ownerId) ?? emptyCounts();
          pc[status]++;
          personCounts.set(g.ownerId, pc);
          personAgents.set(g.ownerId, (personAgents.get(g.ownerId) ?? 0) + 1);
        }
        agents.push({
          kind: 'agent', id: `agent:${a.node_id}`, name: a.alias || a.node_id, deptId: entry.dept.id, groupId: g.id,
          ownerId: g.ownerId, agent: a, status,
          pos: { x: gx + s.x, y: domeHeight(s.r, g.r), z: gz + s.z },
        });
      });
      if (g.person) {
        const top = domeHeight(0, g.r);
        people.push({
          kind: 'person', id: `person:${g.person.user_id}`, name: personName(g.person), deptId: entry.dept.id, person: g.person,
          pos: { x: gx, y: top + PERSON_LIFT, z: gz }, base: { x: gx, y: top, z: gz }, agents: 0, counts: emptyCounts(),
        });
      }
    }
    for (const s of ORG_STATUSES) totals.counts[s] += counts[s];
    depts.push({
      kind: 'dept', id: entry.dept.id, name: entry.dept.name, parentId: entry.dept.parentId, depth: entry.depth,
      center: { x: cx, y: 0, z: cz }, radius: entry.radius, people: entry.dept.people.length, agents: entry.dept.agents.length,
      counts, unknown: !!entry.dept.unknown,
    });
  });
  for (const p of people) {
    p.agents = personAgents.get(p.id) ?? 0;
    p.counts = personCounts.get(p.id) ?? emptyCounts();
  }
  totals.people = people.length;
  totals.agents = agents.length;
  const extent = depts.reduce((m, d) => Math.max(m, Math.hypot(d.center.x, d.center.z) + d.radius), 1);
  return { depts, people, agents, groups, extent, totals };
}

// ─── 相机 / 投影 ─────────────────────────────────────────────────────────────

export interface OrgView {
  yaw: number;
  pitch: number;
  /** 相对「全景取景」的缩放倍数。 */
  zoom: number;
  /** 观察目标（世界坐标，地面上）。 */
  target: { x: number; z: number };
}

export const DEFAULT_ORG_VIEW: OrgView = { yaw: 0.5, pitch: 0.82, zoom: 1, target: { x: 0, z: 0 } };
/** 相机距离（以 extent 归一化）：取大一点 = 柔和透视，远处部门不会缩成点。 */
const CAMERA_DIST = 3.2;
export const MIN_PITCH = 0.25;
export const MAX_PITCH = 1.45;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 12;

export interface ScreenSize { width: number; height: number }
export interface Projector {
  project(p: Vec3): { x: number; y: number; scale: number; depth: number } | null;
  /** 世界单位 → 像素（在给定点附近）。 */
  pixelsPerUnit: number;
}

/** 视口里给 UI 留出的边距（像素）。 */
export interface SafeArea { top: number; right: number; bottom: number; left: number }

/** 全景取景下的焦距：保证 zoom = 1 时整个场景落在安全区里。 */
export function makeProjector(scene: Pick<OrgScene, 'extent'>, view: OrgView, size: ScreenSize, safe: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 }): Projector {
  const e = scene.extent;
  const w = Math.max(1, size.width - safe.left - safe.right);
  const h = Math.max(1, size.height - safe.top - safe.bottom);
  // 半径 1 的地面圆在俯仰 pitch 下：横向占 2，纵向约 2·sin(pitch)+高度余量。
  // 透视让近端比中心放大约 dist/(dist-cos·pitch)，竖向多留这一份。
  const vertical = (2 * Math.sin(view.pitch) + 0.35 * Math.cos(view.pitch)) * (CAMERA_DIST / (CAMERA_DIST - Math.cos(view.pitch) * 0.6));
  const base = Math.min(w / 2.1, h / vertical) * CAMERA_DIST;
  const focal = base * view.zoom;
  const cx = safe.left + w / 2;
  const cy = safe.top + h / 2;
  const cam = { yaw: view.yaw, pitch: view.pitch, dist: CAMERA_DIST, focal, cx, cy };
  return {
    project: (p: Vec3) => projectPoint({ x: (p.x - view.target.x) / e, y: p.y / e, z: (p.z - view.target.z) / e }, cam, size),
    pixelsPerUnit: focal / CAMERA_DIST / e,
  };
}

/** 当前视角下场景（部门盘边缘 + 成员）的屏幕包围盒。 */
export function projectedBounds(scene: OrgScene, proj: Projector): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (p: Vec3) => {
    const s = proj.project(p);
    if (!s) return;
    x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
  };
  for (const d of scene.depts) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      add({ x: d.center.x + d.radius * Math.cos(a), y: 0, z: d.center.z + d.radius * Math.sin(a) });
    }
  }
  for (const p of scene.people) add(p.pos);
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/** 屏幕位移（像素）→ 地面上的目标位移（世界单位），平移与取景共用。 */
export function screenDeltaToGround(view: OrgView, ppu: number, dx: number, dy: number): { x: number; z: number } {
  const wx = dx / ppu;
  const wz = dy / ppu / Math.max(0.3, Math.sin(view.pitch));
  const c = Math.cos(view.yaw), s = Math.sin(view.yaw);
  return { x: wx * c + wz * s, z: -wx * s + wz * c };
}

/**
 * 按当前朝向把整个场景铺满安全区（留 4% 余量）：调 zoom 与 target。
 * 只在首次进入 / 重置 / 尺寸变化时调用；自转时不重算，避免画面「呼吸」。
 */
export function fitOrgView(scene: OrgScene, view: OrgView, size: ScreenSize, safe: SafeArea): OrgView {
  const w = Math.max(1, size.width - safe.left - safe.right);
  const h = Math.max(1, size.height - safe.top - safe.bottom);
  let v: OrgView = { ...view, zoom: 1, target: { x: 0, z: 0 } };
  for (let iter = 0; iter < 3; iter++) {
    const proj = makeProjector(scene, v, size, safe);
    const b = projectedBounds(scene, proj);
    if (!b) return v;
    const ratio = Math.min(w / Math.max(1, b.x1 - b.x0), h / Math.max(1, b.y1 - b.y0)) * 0.96;
    const shift = screenDeltaToGround(v, proj.pixelsPerUnit, (b.x0 + b.x1) / 2 - (safe.left + w / 2), (b.y0 + b.y1) / 2 - (safe.top + h / 2));
    v = { ...v, zoom: clampZoom(v.zoom * ratio), target: { x: v.target.x + shift.x, z: v.target.z + shift.z } };
  }
  return v;
}

export interface ProjectedBody {
  body: OrgBody;
  x: number;
  y: number;
  /** 屏幕半径（像素）。部门为椭圆长半轴。 */
  r: number;
  depth: number;
}

/** 投影全部节点并按远 → 近排序（画家算法）。 */
export function projectOrgScene(scene: OrgScene, proj: Projector): { depts: ProjectedBody[]; nodes: ProjectedBody[] } {
  const depts: ProjectedBody[] = [];
  for (const d of scene.depts) {
    const p = proj.project(d.center);
    if (p) depts.push({ body: d, x: p.x, y: p.y, r: (d.radius / scene.extent) * p.scale, depth: p.depth });
  }
  const nodes: ProjectedBody[] = [];
  for (const a of scene.agents) {
    const p = proj.project(a.pos);
    if (p) nodes.push({ body: a, x: p.x, y: p.y, r: Math.max(1.6, AGENT_RADIUS * p.scale / scene.extent), depth: p.depth });
  }
  for (const person of scene.people) {
    const p = proj.project(person.pos);
    if (p) nodes.push({ body: person, x: p.x, y: p.y, r: Math.max(9, Math.min(22, 0.75 * p.scale / scene.extent)), depth: p.depth });
  }
  depts.sort((a, b) => b.depth - a.depth);
  nodes.sort((a, b) => b.depth - a.depth);
  return { depts, nodes };
}

/** 屏幕点命中：先节点（前面的优先，命中半径至少 6px），再部门盘（椭圆）。 */
export function hitOrg(projected: { depts: ProjectedBody[]; nodes: ProjectedBody[] }, x: number, y: number, pitch: number, labels: readonly PlacedLabel[] = []): OrgBody | null {
  let best: ProjectedBody | null = null;
  let bestD = Infinity;
  for (let i = projected.nodes.length - 1; i >= 0; i--) {
    const n = projected.nodes[i];
    const d = Math.hypot(n.x - x, n.y - y);
    const reach = Math.max(n.r + 2, 6);
    if (d <= reach && d / reach < bestD) { best = n; bestD = d / reach; }
  }
  if (best) return best.body;
  for (const l of labels) if (x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h) return l.body;
  const squash = Math.max(0.2, Math.sin(pitch));
  let dept: ProjectedBody | null = null;
  for (const d of projected.depts) {
    const dx = (x - d.x) / d.r;
    const dy = (y - d.y) / (d.r * squash);
    if (dx * dx + dy * dy <= 1 && (!dept || d.r < dept.r)) dept = d;
  }
  return dept?.body ?? null;
}

// ─── 标签避让 ────────────────────────────────────────────────────────────────

export interface LabelRequest {
  id: string;
  body: OrgBody;
  /** 锚点（像素）：标签围绕它找位置。 */
  x: number;
  y: number;
  /** 锚点本身占的半径：标签不能盖住它。 */
  r: number;
  w: number;
  h: number;
  /** 越大越先放。 */
  priority: number;
  /** 放不下也必须出现（部门、成员）；可选的（Agent）放不下就不画。 */
  required: boolean;
}

export interface PlacedLabel extends LabelRequest {
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  /** 离锚点较远，需要画一条引线。 */
  leader: boolean;
  /** 实在放不下，只能叠着画（仅 required 会出现）。 */
  forced: boolean;
}

export function rectsOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, pad = 0): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

function rectHitsCircle(rect: { x: number; y: number; w: number; h: number }, cx: number, cy: number, r: number): boolean {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  return Math.hypot(nx - cx, ny - cy) < r;
}

/**
 * 贪心标签避让：按优先级逐个放，候选位置为锚点上/下/右/左，再逐圈外扩。
 * 保证：非 forced 的标签两两不重叠、不出界、不盖住任何 required 标签的锚点。
 */
export function layoutOrgLabels(requests: readonly LabelRequest[], size: ScreenSize, margin = 4): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const anchors = requests.filter(r => r.required);
  const sorted = [...requests].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const req of sorted) {
    const gap = 4;
    const candidates: { x: number; y: number; far: boolean }[] = [];
    for (let ring = 0; ring < (req.required ? 7 : 2); ring++) {
      const d = req.r + gap + ring * (req.h + 2);
      candidates.push(
        { x: req.x - req.w / 2, y: req.y - d - req.h, far: ring > 1 },
        { x: req.x - req.w / 2, y: req.y + d, far: ring > 1 },
        { x: req.x + d, y: req.y - req.h / 2, far: ring > 1 },
        { x: req.x - d - req.w, y: req.y - req.h / 2, far: ring > 1 },
      );
      if (ring > 0) {
        candidates.push(
          { x: req.x + d * 0.7, y: req.y - d * 0.7 - req.h, far: ring > 1 },
          { x: req.x - d * 0.7 - req.w, y: req.y - d * 0.7 - req.h, far: ring > 1 },
          { x: req.x + d * 0.7, y: req.y + d * 0.7, far: ring > 1 },
          { x: req.x - d * 0.7 - req.w, y: req.y + d * 0.7, far: ring > 1 },
        );
      }
    }
    let chosen: (typeof candidates)[number] | null = null;
    for (const c of candidates) {
      const rect = { x: c.x, y: c.y, w: req.w, h: req.h };
      if (rect.x < margin || rect.y < margin || rect.x + rect.w > size.width - margin || rect.y + rect.h > size.height - margin) continue;
      if (placed.some(p => rectsOverlap(rect, p, 2))) continue;
      if (anchors.some(a => a.id !== req.id && rectHitsCircle(rect, a.x, a.y, Math.min(a.r, 24)))) continue;
      chosen = c;
      break;
    }
    if (!chosen && !req.required) continue;
    const c = chosen ?? candidates[0];
    placed.push({
      ...req, x: Math.max(margin, Math.min(size.width - margin - req.w, c.x)), y: Math.max(margin, Math.min(size.height - margin - req.h, c.y)),
      anchorX: req.x, anchorY: req.y, leader: !chosen || c.far, forced: !chosen,
    });
  }
  return placed;
}

// ─── 搜索 / 详情 ─────────────────────────────────────────────────────────────

/** 名称包含即命中；部门 → 成员 → Agent 依次排在前面。 */
export function searchOrg(scene: OrgScene, query: string, limit = 8): OrgBody[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [];
  const hit = (s: string) => s.toLocaleLowerCase().includes(q);
  const out: OrgBody[] = [
    ...scene.depts.filter(d => hit(d.name)),
    ...scene.people.filter(p => hit(p.name) || hit(p.person.username)),
    ...scene.agents.filter(a => hit(a.name) || hit(a.agent.node_id)),
  ];
  return out.slice(0, limit);
}

/** 选中某个节点时要高亮的 id 集合（部门 = 盘内全部；成员 = 名下全部 Agent，跨部门）。 */
export function relatedIds(scene: OrgScene, body: OrgBody | null): Set<string> | null {
  if (!body) return null;
  const ids = new Set<string>([body.id]);
  if (body.kind === 'dept') {
    for (const a of scene.agents) if (a.deptId === body.id) ids.add(a.id);
    for (const p of scene.people) if (p.deptId === body.id) ids.add(p.id);
  } else if (body.kind === 'person') {
    for (const a of scene.agents) if (a.ownerId === body.id) { ids.add(a.id); ids.add(a.deptId); }
    ids.add(body.deptId);
  } else {
    ids.add(body.deptId);
    if (body.ownerId) ids.add(body.ownerId);
  }
  return ids;
}

/** 聚焦某个节点时的取景：目标移到它所在位置，缩放到能看清这一团。 */
export function focusView(scene: OrgScene, body: OrgBody, view: OrgView): OrgView {
  if (body.kind === 'dept') {
    return { ...view, target: { x: body.center.x, z: body.center.z }, zoom: clampZoom(scene.extent / (body.radius * 1.25)) };
  }
  const p = body.kind === 'person' ? body.base : body.pos;
  const group = body.kind === 'agent' ? scene.groups.find(g => g.id === body.groupId) : scene.groups.find(g => g.ownerId === body.id && g.deptId === body.deptId);
  const r = Math.max(2.5, (group?.radius ?? 2) * 2.2);
  return { ...view, target: { x: p.x, z: p.z }, zoom: clampZoom(scene.extent / r) };
}

export function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

/** 详情卡里的状态分布行：只列非零档，按图例顺序。 */
export function countsSummary(counts: StatusCounts): string {
  const parts = ORG_STATUSES.filter(s => counts[s] > 0).map(s => `${ORG_STATUS_LABEL[s]} ${counts[s]}`);
  return parts.length ? parts.join(' · ') : '暂无 Agent';
}
