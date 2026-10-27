/**
 * 军团 3D —— 把 2D 极坐标编制（legion-layout.ts）抬成三层轨道塔。
 *
 * 为什么要单独一层纯函数：
 *   3D 里「看起来对」比 2D 更容易骗人 —— 一个点画在左边，你没法从截图
 *   判断它是真的投影正确，还是旋转矩阵写错了某个符号。所以旋转、透视、
 *   深度排序、命中测试全部在这里算，组件只负责把结果画出来；断言在
 *   legion-3d.test.mjs 里钉住。
 *
 * 坐标约定（右手系，y 向上）：
 *   - 场景平面 x/z 复用 2D 布局的 x/y（单位 1 = 最外环半径）；
 *   - 高度 y 按环递减：圆心最高，部门 → 成员 → Agent 逐层下沉，
 *     从斜上方看是一叠错开的轨道，而不是一张贴平的饼图；
 *   - 相机在 +z 方向，yaw 绕 y 轴、pitch 绕 x 轴，先 yaw 后 pitch。
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Camera3D {
  /** 绕 y 轴旋转（弧度）。0 = 不转。 */
  yaw: number;
  /** 俯仰（弧度）。0 = 平视，Math.PI / 2 = 正俯视。 */
  pitch: number;
  /** 相机到原点的距离（场景单位）。 */
  dist: number;
  /** 焦距（像素）。通常取画布短边的一部分。 */
  focal: number;
  /** 投影中心（像素）。默认画布中心；缩放锚定鼠标时由页面传入偏移。 */
  cx?: number;
  cy?: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  /** 透视缩放系数，用于算节点半径 / 标签字号。 */
  scale: number;
  /** 相机空间深度（越大越远）。排序与雾化都用它。 */
  depth: number;
}

/** 每层的高度（场景单位）。ring 0 = 圆心。 */
export const RING_HEIGHT: Record<number, number> = {
  0: 0,
  1: -0.34,
  2: -0.60,
  3: -0.86,
};

/** 节点在环上的微小高度抖动：让同一环不是一张绝对平的薄片。
 *  确定性（按 order 取正弦），同一份输入永远得到同一张图。 */
export function jitterHeight(order: number, ring: number): number {
  if (ring === 0) return 0;
  return Math.sin(order * 1.7) * 0.035;
}

/** 2D 布局节点 → 3D 坐标。x/z 用平面坐标，y 用环高度 + 抖动。 */
export function nodeToVec3(
  node: { x: number; y: number; ring: number; order: number },
  scale = 1,
): Vec3 {
  return {
    x: node.x * scale,
    y: (RING_HEIGHT[node.ring] ?? 0) + jitterHeight(node.order, node.ring),
    z: node.y * scale,
  };
}

/** 单个 3D 点 → 屏幕坐标。相机背后（depth <= 0.05）返回 null。 */
export function projectPoint(
  p: Vec3,
  cam: Camera3D,
  size: { width: number; height: number },
): ProjectedPoint | null {
  const cosY = Math.cos(cam.yaw);
  const sinY = Math.sin(cam.yaw);
  const x1 = p.x * cosY - p.z * sinY;
  const z1 = p.x * sinY + p.z * cosY;

  const cosP = Math.cos(cam.pitch);
  const sinP = Math.sin(cam.pitch);
  const y2 = p.y * cosP - z1 * sinP;
  const z2 = p.y * sinP + z1 * cosP;

  // 相机在 +z 侧、看向 -z：z2 越大越靠近相机，所以深度是 dist - z2。
  const depth = cam.dist - z2;
  if (!Number.isFinite(depth) || depth <= 0.05) return null;

  const scale = cam.focal / depth;
  const cx = cam.cx ?? size.width / 2;
  const cy = cam.cy ?? size.height / 2;
  return {
    x: cx + x1 * scale,
    y: cy - y2 * scale,
    scale,
    depth,
  };
}

export interface SceneNode<T> {
  item: T;
  point: Vec3;
  projected: ProjectedPoint;
}

/** 部门盘的屏幕尺寸，绘制与命中测试共用，缩放后也能点中盘面边缘。 */
export function groupDiscRadii(radiusPx: number): { rx: number; ry: number } {
  const rx = Math.max(16, radiusPx * 2.1);
  return { rx, ry: rx * 0.42 };
}

/**
 * 整场景投影 + 远→近排序。画家算法在这里够用：节点之间不重叠成
 * 互相穿插的实体，先画远的再画近的就不会被盖穿。
 */
export function projectScene<T>(
  items: T[],
  toPoint: (item: T) => Vec3,
  cam: Camera3D,
  size: { width: number; height: number },
): Array<SceneNode<T>> {
  const out: Array<SceneNode<T>> = [];
  for (const item of items) {
    const point = toPoint(item);
    const projected = projectPoint(point, cam, size);
    if (projected) out.push({ item, point, projected });
  }
  out.sort((a, b) => b.projected.depth - a.projected.depth);
  return out;
}

/**
 * 命中测试：取覆盖屏幕点、**离相机最近**的节点。
 * radius 是最小命中半径；可选的椭圆尺寸让部门盘的命中区域跟随绘制尺寸。
 * 传的是已排序（远→近）的数组，所以从后往前找第一个命中即可。
 */
export function hitTest<T>(
  nodes: Array<SceneNode<T>>,
  x: number,
  y: number,
  radius: number,
  ellipse?: (node: SceneNode<T>) => { rx: number; ry: number } | undefined,
): SceneNode<T> | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const dx = n.projected.x - x;
    const dy = n.projected.y - y;
    const shape = ellipse?.(n);
    if (shape) {
      const rx = Math.max(radius, shape.rx);
      const ry = Math.max(radius, shape.ry);
      if ((dx / rx) ** 2 + (dy / ry) ** 2 <= 1) return n;
    } else if (dx * dx + dy * dy <= radius * radius) return n;
  }
  return null;
}

/** 深度雾化系数：0 = 最近（最实），1 = 最远（最淡）。 */
export function fog(depth: number, near: number, far: number): number {
  if (far <= near) return 0;
  const t = (depth - near) / (far - near);
  return Math.min(1, Math.max(0, t));
}

/** 画一圈参考轨道：给定半径与高度，采样 segments 个点后投影。 */
export function ringPath(
  radius: number,
  height: number,
  cam: Camera3D,
  size: { width: number; height: number },
  segments = 96,
): Array<{ x: number; y: number; depth: number }> {
  const points: Array<{ x: number; y: number; depth: number }> = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const p = projectPoint({ x: Math.sin(a) * radius, y: height, z: Math.cos(a) * radius }, cam, size);
    if (p) points.push({ x: p.x, y: p.y, depth: p.depth });
  }
  return points;
}
