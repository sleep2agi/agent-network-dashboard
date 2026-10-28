import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlazaWorld, constrainPlazaCamera, fitPlazaWorld, PLAZA_CAMERA, plazaFlowPhase, plazaFlowStreak, plazaPlateCorners, projectPlazaPoint } from './plaza-perspective.ts';
import { plazaAgentSnapshots } from './plaza-perspective-metadata.ts';
import type { PlazaDepartment } from '../../lib/legion-directory.ts';
import type { Session } from '../../components/types.ts';

const departments: PlazaDepartment[] = Array.from({ length: 6 }, (_, i) => ({
  id: `dept:${i}`, name: `Department ${i}`, parentId: i ? `dept:${i - 1}` : null, people: [], agents: [],
}));

test('all empty and deeply nested departments retain identity, XYZ height and parent links', () => {
  const world = buildPlazaWorld(departments);
  assert.equal(world.platforms.length, departments.length);
  assert.deepEqual(world.platforms.map(p => p.depth), [1, 2, 3, 4, 5, 6]);
  assert.ok(world.platforms[5].center.y > world.platforms[0].center.y);
  assert.deepEqual(world.links.map(l => l.from), ['network', 'dept:0', 'dept:1', 'dept:2', 'dept:3', 'dept:4']);
  assert.ok(world.links.every(link => link.length > 0 && Number.isFinite(link.length)));
  const cycles = departments.map((p, i) => ({ ...p, parentId: departments[(i + 1) % departments.length].id }));
  assert.equal(buildPlazaWorld(cycles).platforms.length, 6);
});

test('a non-origin platform rotates in both axes; unchanged camera is stable for 130 frames; reset is exact', () => {
  const world = buildPlazaWorld(departments), frame = fitPlazaWorld(world, { width: 1180, height: 690 });
  const point = world.platforms[0].center;
  const before = projectPlazaPoint(point, PLAZA_CAMERA, frame);
  const moved = { ...PLAZA_CAMERA, yaw: PLAZA_CAMERA.yaw + 0.7, pitch: 0.65 };
  const after = projectPlazaPoint(point, moved, frame);
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 20);
  for (let i = 0; i < 130; i++) assert.deepEqual(projectPlazaPoint(point, moved, frame), after);
  assert.deepEqual(projectPlazaPoint(point, { ...PLAZA_CAMERA }, frame), before);
  // Tilt changes the actual projected quadrilateral, not only a wrapper transform.
  const corners = plazaPlateCorners(point);
  assert.notDeepEqual(corners.map(p => projectPlazaPoint(p, moved, frame)), corners.map(p => projectPlazaPoint(p, PLAZA_CAMERA, frame)));
});

test('perspective grows near objects and depth order reverses under a half turn', () => {
  const frame = { width: 1000, height: 700, scale: 1, distance: 3000, offsetY: 0 };
  const camera = { ...PLAZA_CAMERA, yaw: 0, pitch: 0 };
  const near = { x: 300, y: 0, z: 400 }, far = { x: 300, y: 0, z: -400 };
  assert.ok(projectPlazaPoint(near, camera, frame).scale > projectPlazaPoint(far, camera, frame).scale);
  assert.ok(projectPlazaPoint(near, camera, frame).depth > projectPlazaPoint(far, camera, frame).depth);
  assert.ok(projectPlazaPoint(near, { ...camera, yaw: Math.PI }, frame).depth < projectPlazaPoint(far, { ...camera, yaw: Math.PI }, frame).depth);
});

test('flow phase/streak uses world length and clock; projection, resize and zoom do not change it', () => {
  const world = buildPlazaWorld(departments), link = world.links[3];
  const phase = plazaFlowPhase(link, 12.5), streak = plazaFlowStreak(link, 12.5);
  for (const yaw of [-2, 0, 0.5, 2]) {
    const frame = fitPlazaWorld(world, { width: 920 + yaw * 100, height: 700 });
    streak.map(p => projectPlazaPoint(p, { ...PLAZA_CAMERA, yaw, zoom: 2 }, frame));
    assert.equal(plazaFlowPhase(link, 12.5), phase);
    assert.deepEqual(plazaFlowStreak(link, 12.5), streak);
  }
  assert.notEqual(plazaFlowPhase(link, 13), phase);
  assert.ok(streak.every(p => Object.values(p).every(Number.isFinite)));
});

test('fit is finite for empty, singleton, deep and large worlds and camera bounds stay usable', () => {
  for (const input of [[], departments.slice(0, 1), departments, Array.from({ length: 90 }, (_, i) => ({ ...departments[0], id: `deep:${i}`, parentId: i ? `deep:${i - 1}` : null }))]) {
    const world = buildPlazaWorld(input);
    for (const width of [390, 1180, 1580]) {
      const frame = fitPlazaWorld(world, { width, height: 680 });
      assert.ok(Object.values(frame).every(Number.isFinite));
      assert.ok(frame.scale > 0);
      for (const p of world.platforms) assert.ok(Object.values(projectPlazaPoint(p.center, PLAZA_CAMERA, frame)).every(Number.isFinite));
    }
  }
  assert.equal(constrainPlazaCamera({ ...PLAZA_CAMERA, zoom: 100, pitch: 5 }).zoom, 4);
  assert.equal(constrainPlazaCamera({ ...PLAZA_CAMERA, zoom: 0, pitch: -5 }).pitch, 0.28);
});

test('namecards only use canonical node sessions in the selected network; node metadata cannot invent status', () => {
  const sessions = [
    { node_id: 'old', alias: 'Same alias', status: 'working', model: 'old-model', network_id: 'A' },
    { node_id: 'new', alias: 'Same alias', status: 'blocked', model: 'session-model', runtime: 'session-runtime', network_id: 'A' },
    { node_id: 'new', alias: 'Same alias', status: 'error', model: 'wrong-network', network_id: 'B' },
    { alias: 'Same alias', status: 'working', model: 'alias-only', network_id: 'A' },
  ] as Session[];
  const snapshots = plazaAgentSnapshots([{ node_id: 'new', network_id: 'A', model: 'node-model' }, { node_id: 'no-session', runtime: 'opencode' }], sessions, 'A');
  assert.deepEqual(snapshots.get('new'), { status: 'blocked', model: 'node-model', runtime: 'session-runtime' });
  assert.equal(snapshots.get('no-session')?.status, undefined);
  assert.equal(snapshots.get('missing'), undefined);
  assert.equal(plazaAgentSnapshots([], sessions, 'B').get('new')?.status, 'error');
});
