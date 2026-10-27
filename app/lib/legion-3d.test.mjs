import { describe, expect, test } from 'bun:test';
import {
  RING_HEIGHT,
  fog,
  hitTest,
  jitterHeight,
  nodeToVec3,
  projectPoint,
  projectScene,
  ringPath,
} from './legion-3d';

const SIZE = { width: 800, height: 600 };
const CAM = { yaw: 0, pitch: 0, dist: 4, focal: 600 };

describe('#3D 军团拓扑 — 投影/深度/命中必须可断言，不能靠截图判断', () => {
  test('原点永远落在画布中心（与 yaw/pitch 无关）', () => {
    for (const yaw of [0, 0.7, Math.PI, -2.1]) {
      for (const pitch of [0, 0.9, 1.4]) {
        const p = projectPoint({ x: 0, y: 0, z: 0 }, { ...CAM, yaw, pitch }, SIZE);
        expect(p).not.toBeNull();
        expect(p.x).toBeCloseTo(SIZE.width / 2, 6);
        expect(p.y).toBeCloseTo(SIZE.height / 2, 6);
        expect(p.depth).toBeCloseTo(CAM.dist, 6);
      }
    }
  });

  test('平视时水平方向不翻：+x 在右，+y 在上', () => {
    const right = projectPoint({ x: 1, y: 0, z: 0 }, CAM, SIZE);
    const up = projectPoint({ x: 0, y: 1, z: 0 }, CAM, SIZE);
    expect(right.x).toBeGreaterThan(SIZE.width / 2);
    expect(right.y).toBeCloseTo(SIZE.height / 2, 6);
    expect(up.y).toBeLessThan(SIZE.height / 2);
    expect(up.x).toBeCloseTo(SIZE.width / 2, 6);
  });

  test('yaw = 90° 把 +x 转到相机近侧（深度变小、屏幕居中）', () => {
    const a = projectPoint({ x: 1, y: 0, z: 0 }, CAM, SIZE);
    const b = projectPoint({ x: 1, y: 0, z: 0 }, { ...CAM, yaw: Math.PI / 2 }, SIZE);
    expect(b.depth).toBeCloseTo(a.depth - 1, 6);
    expect(b.x).toBeCloseTo(SIZE.width / 2, 6);
  });

  test('相机背后返回 null，不产出 NaN 坐标', () => {
    // 相机在 +z=4 处看向 -z：z=+10 已经跑到相机背后。
    const behind = projectPoint({ x: 0, y: 0, z: 10 }, CAM, SIZE);
    expect(behind).toBeNull();
    const scene = projectScene(
      [{ id: 'a', p: { x: 0, y: 0, z: 0 } }, { id: 'b', p: { x: 0, y: 0, z: 99 } }],
      n => n.p,
      CAM,
      SIZE,
    );
    expect(scene).toHaveLength(1);
    for (const n of scene) {
      expect(Number.isFinite(n.projected.x)).toBe(true);
      expect(Number.isFinite(n.projected.y)).toBe(true);
    }
  });

  test('整场景按远→近排序：先画远的，近的才能盖在上面', () => {
    const items = [
      { id: 'near', p: { x: 0, y: 0, z: 2 } },
      { id: 'far', p: { x: 0, y: 0, z: -2 } },
      { id: 'mid', p: { x: 0, y: 0, z: 0 } },
    ];
    const scene = projectScene(items, n => n.p, CAM, SIZE);
    expect(scene.map(s => s.item.id)).toEqual(['far', 'mid', 'near']);
    for (let i = 1; i < scene.length; i++) {
      expect(scene[i].projected.depth).toBeLessThanOrEqual(scene[i - 1].projected.depth);
    }
  });

  test('命中测试取离相机最近的一个（重叠时选前面的，不是数组第一个）', () => {
    const items = [
      { id: 'near', p: { x: 0, y: 0, z: 2 } },
      { id: 'far', p: { x: 0, y: 0, z: -2 } },
    ];
    const scene = projectScene(items, n => n.p, CAM, SIZE);
    const hit = hitTest(scene, SIZE.width / 2 + 1, SIZE.height / 2 + 1, 8);
    expect(hit?.item.id).toBe('near');
    expect(hitTest(scene, 5, 5, 8)).toBeNull();
  });

  test('层级高度：圆心最高，Agent 最低（视觉上是一叠轨道，不是平饼）', () => {
    expect(RING_HEIGHT[0]).toBe(0);
    expect(RING_HEIGHT[1]).toBeLessThan(RING_HEIGHT[0]);
    expect(RING_HEIGHT[2]).toBeLessThan(RING_HEIGHT[1]);
    expect(RING_HEIGHT[3]).toBeLessThan(RING_HEIGHT[2]);
    const core = nodeToVec3({ x: 0, y: 0, ring: 0, order: 0 });
    const agent = nodeToVec3({ x: 1, y: 0, ring: 3, order: 7 });
    expect(core.y).toBeGreaterThan(agent.y);
  });

  test('高度抖动是确定性的：同一 order 恒定，不同 order 不同', () => {
    expect(jitterHeight(3, 2)).toBe(jitterHeight(3, 2));
    expect(jitterHeight(3, 2)).not.toBe(jitterHeight(4, 2));
    expect(Math.abs(jitterHeight(9, 1))).toBeLessThan(0.05);
    expect(jitterHeight(9, 0)).toBe(0);
  });

  test('深度雾化被夹在 [0,1]，far<=near 时退化为 0 而不是 NaN', () => {
    expect(fog(2, 2, 6)).toBe(0);
    expect(fog(4, 2, 6)).toBeCloseTo(0.5, 6);
    expect(fog(99, 2, 6)).toBe(1);
    expect(fog(1, 6, 2)).toBe(0);
  });

  test('轨道环采样点数固定，且每点都在画布附近（不飞出视图）', () => {
    const pts = ringPath(1, -0.3, { ...CAM, pitch: 0.9 }, SIZE, 48);
    expect(pts.length).toBe(49);
    for (const p of pts) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Math.abs(p.x - SIZE.width / 2)).toBeLessThan(SIZE.width);
    }
  });
});
