import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutPlazaLabels, plazaLabelsOverlap } from './plaza-label-layout.ts';
import { buildPlazaWorld, fitPlazaWorld, PLAZA_CAMERA, projectPlazaPoint } from './plaza-perspective.ts';
import type { PlazaDepartment } from '../../lib/legion-directory.ts';

function scene(count: number, width: number, camera = PLAZA_CAMERA) {
  const departments = Array.from({ length: count }, (_, i) => ({ id: `d${i}`, name: `Department ${i}`,
    parentId: i > 11 ? `d${i - 12}` : null, agents: [], people: [] })) as PlazaDepartment[];
  const world = buildPlazaWorld(departments), viewport = { width, height: 776 }, frame = fitPlazaWorld(world, viewport);
  const p = projectPlazaPoint(world.core, camera, frame), r = Math.max(23, Math.min(42, 68 * p.scale));
  return { viewport, core: { x: p.x - r - 30, y: p.y - r - 10, width: r * 2 + 60, height: r * 2 + 58 },
    anchors: world.platforms.map(a => ({ id: a.department.id, ...projectPlazaPoint(a.center, camera, frame), agents: 6 })) };
}

function readable(result: ReturnType<typeof layoutPlazaLabels>, fixture: ReturnType<typeof scene>) {
  const labels = [...result.labels.values()];
  for (const label of labels) {
    assert(label.x >= 0 && label.y >= 0 && label.x + label.width <= fixture.viewport.width && label.y + label.height <= fixture.viewport.height);
    assert(!plazaLabelsOverlap(label, fixture.core), `core hidden by ${label.id}`);
    for (const other of labels) if (other !== label) assert(!plazaLabelsOverlap(label, other), `${label.id} overlaps ${other.id}`);
  }
}

test('dense desktop overview keeps eighteen readable cards and the selected six-node detail', () => {
  for (const width of [854, 1334]) {
    const fixture = scene(18, width);
    const result = layoutPlazaLabels(fixture.anchors, fixture.viewport, fixture.core, 'd0');
    assert.equal(result.labels.size, 18, `missing cards at ${width}`);
    assert.equal(result.labels.get('d0')?.rows, 6);
    readable(result, fixture);
  }
});

test('normal six-platform view retains four-node summaries and full selected details', () => {
  const fixture = scene(6, 1334);
  const result = layoutPlazaLabels(fixture.anchors, fixture.viewport, fixture.core, 'd0');
  assert.equal(result.dense, false); assert.equal(result.hidden, 0);
  assert.equal(result.labels.get('d0')?.rows, 6);
  for (const label of result.labels.values()) if (label.id !== 'd0') assert.equal(label.rows, 4);
  readable(result, fixture);
});

test('selected card stays readable after orbit, pan and narrow viewport without changing anchors', () => {
  for (const width of [340, 854]) for (const yaw of [0.28, 1.8, 3.6]) {
    const fixture = scene(18, width, { ...PLAZA_CAMERA, yaw, panX: 120, panY: -220 });
    const before = structuredClone(fixture.anchors);
    const result = layoutPlazaLabels(fixture.anchors, fixture.viewport, fixture.core, 'd17');
    assert.equal(result.labels.get('d17')?.rows, 6);
    readable(result, fixture); assert.deepEqual(fixture.anchors, before);
  }
});

test('oversized networks expose omitted cards and placement is deterministic', () => {
  const fixture = scene(120, 854);
  const result = layoutPlazaLabels(fixture.anchors, fixture.viewport, fixture.core, 'd119');
  assert.equal(result.labels.get('d119')?.rows, 6);
  assert.equal(result.labels.size + result.hidden, 120); assert(result.hidden > 0);
  readable(result, fixture);
  assert.deepEqual(layoutPlazaLabels([...fixture.anchors].reverse(), fixture.viewport, fixture.core, 'd119'), result);
});
