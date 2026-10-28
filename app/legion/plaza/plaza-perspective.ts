import type { PlazaDepartment } from '../../lib/legion-directory';

/** World units: X right, Y up, Z towards the viewer before orbiting. */
export interface PlazaVec3 { x: number; y: number; z: number }
export interface PlazaCamera { yaw: number; pitch: number; zoom: number; panX: number; panY: number }
export interface PlazaViewport { width: number; height: number }
export interface PlazaProjection extends PlazaViewport { scale: number; distance: number; offsetY: number }
export interface PlazaWorldPlatform { department: PlazaDepartment; center: PlazaVec3; depth: number }
export interface PlazaWorldLink { id: string; from: string; to: string; points: PlazaVec3[]; lengths: number[]; length: number }
export interface PlazaWorld { platforms: PlazaWorldPlatform[]; core: PlazaVec3; links: PlazaWorldLink[] }
export const PLAZA_CAMERA: Readonly<PlazaCamera> = { yaw: 0.28, pitch: 0.98, zoom: 1, panX: 0, panY: 0 };
export const PLAZA_PLATE = { width: 350, depth: 250, thickness: 20 };
export const PLAZA_LABEL_WIDTH = 224;
export const PLAZA_LABEL_HEIGHT = 270; // six 33px rows + header/footer + stem

export function constrainPlazaCamera(camera: PlazaCamera): PlazaCamera {
  return { ...camera, pitch: Math.max(0.28, Math.min(1.4, camera.pitch)), zoom: Math.max(0.3, Math.min(4, camera.zoom)) };
}

export function rotatePlazaPoint(point: PlazaVec3, camera: PlazaCamera): PlazaVec3 {
  const x = point.x * Math.cos(camera.yaw) - point.z * Math.sin(camera.yaw);
  const z = point.x * Math.sin(camera.yaw) + point.z * Math.cos(camera.yaw);
  return { x, y: point.y * Math.cos(camera.pitch) - z * Math.sin(camera.pitch),
    z: point.y * Math.sin(camera.pitch) + z * Math.cos(camera.pitch) };
}

export function projectPlazaPoint(point: PlazaVec3, camera: PlazaCamera, frame: PlazaProjection) {
  const rotated = rotatePlazaPoint(point, camera);
  // distance is derived from the world bounding sphere, never from yaw/pitch.
  const scale = frame.scale * camera.zoom * frame.distance / Math.max(1, frame.distance - rotated.z);
  return { x: frame.width / 2 + camera.panX + rotated.x * scale,
    y: frame.height / 2 + frame.offsetY + camera.panY - rotated.y * scale, depth: rotated.z, scale };
}

export function plazaPlateCorners(center: PlazaVec3, bottom = false): PlazaVec3[] {
  const w = PLAZA_PLATE.width / 2, d = PLAZA_PLATE.depth / 2;
  return [[-w, -d], [w, -d], [w, d], [-w, d]].map(([x, z]) => ({
    x: center.x + x, y: center.y - (bottom ? PLAZA_PLATE.thickness : 0), z: center.z + z,
  }));
}

export function plazaPath(points: { x: number; y: number }[], close = false): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') + (close ? ' Z' : '');
}

/** Ordered terraces keep deep/empty departments visible without changing their identity. */
export function buildPlazaWorld(departments: PlazaDepartment[]): PlazaWorld {
  const byId = new Map(departments.map(d => [d.id, d]));
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(departments.length * 1.3))));
  const rows = Math.ceil(departments.length / columns);
  // Leave a full aisle for the core between the two central rows.
  const split = Math.ceil(rows / 2);
  const rowZ = (row: number) => (row < split ? row - split : row - split + 1) * 440;
  const platforms = departments.map((department, index) => {
    let depth = 1, parent = department.parentId;
    const seen = new Set([department.id]);
    while (parent && byId.has(parent) && !seen.has(parent)) {
      seen.add(parent); depth++; parent = byId.get(parent)!.parentId;
    }
    const row = Math.floor(index / columns);
    const count = Math.min(columns, departments.length - row * columns);
    const x = (index % columns - (count - 1) / 2) * 670;
    const z = rows === 1 ? 370 : rowZ(row);
    // The default composition has evenly spaced terraces; it remains real world geometry.
    const yaw = PLAZA_CAMERA.yaw;
    return { department, depth, center: { x: x * Math.cos(yaw) + z * Math.sin(yaw),
      y: (depth - 1) * 32, z: -x * Math.sin(yaw) + z * Math.cos(yaw) } };
  });
  const core = { x: 0, y: 460, z: rows === 1 ? -260 : 0 };
  const worldById = new Map(platforms.map(p => [p.department.id, p]));
  const links = platforms.map(platform => {
    const parent = platform.department.parentId ? worldById.get(platform.department.parentId) : undefined;
    const a = parent?.center ?? core, b = platform.center;
    const points = Array.from({ length: 33 }, (_, i) => {
      const t = i / 32;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
        y: a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * 75 - 6 };
    });
    const lengths = [0];
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1], q = points[i];
      lengths.push(lengths[i - 1] + Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z));
    }
    return { id: `${parent?.department.id ?? 'network'}>${platform.department.id}`,
      from: parent?.department.id ?? 'network', to: platform.department.id, points, lengths, length: lengths.at(-1)! };
  });
  return { platforms, core, links };
}

/** Fit ONLY the reference camera. Manual orbit never becomes an input to autofit. */
export function fitPlazaWorld(world: PlazaWorld, viewport: PlazaViewport): PlazaProjection {
  const points = [world.core, ...world.platforms.flatMap(p => [...plazaPlateCorners(p.center), ...plazaPlateCorners(p.center, true)])];
  const radius = Math.max(600, ...points.map(p => Math.hypot(p.x, p.y, p.z)));
  const frame = { ...viewport, scale: 1, distance: radius * 3.5, offsetY: 0 };
  let scale = 1;
  // Reserve screen-space text: unlike geometry, labels must not shrink into illegibility.
  for (let i = 0; i < 8; i++) {
    const current = { ...frame, scale };
    const projected = points.map(p => projectPlazaPoint(p, PLAZA_CAMERA, current));
    const labels = world.platforms.map(p => projectPlazaPoint(p.center, PLAZA_CAMERA, current));
    const minX = Math.min(...projected.map(p => p.x), ...labels.map(p => p.x - PLAZA_LABEL_WIDTH / 2));
    const maxX = Math.max(...projected.map(p => p.x), ...labels.map(p => p.x + PLAZA_LABEL_WIDTH / 2));
    const minY = Math.min(...projected.map(p => p.y - 46), ...labels.map(p => p.y - PLAZA_LABEL_HEIGHT));
    const maxY = Math.max(...projected.map(p => p.y + 35));
    const ratio = Math.min((viewport.width - 56) / Math.max(1, maxX - minX), (viewport.height - 56) / Math.max(1, maxY - minY));
    if (Math.abs(ratio - 1) < 0.003) break;
    scale *= Math.max(0.3, Math.min(1.5, ratio));
  }
  const current = { ...frame, scale };
  const projected = points.map(p => projectPlazaPoint(p, PLAZA_CAMERA, current));
  const labels = world.platforms.map(p => projectPlazaPoint(p.center, PLAZA_CAMERA, current));
  const top = Math.min(...projected.map(p => p.y - 46), ...labels.map(p => p.y - PLAZA_LABEL_HEIGHT));
  const bottom = Math.max(...projected.map(p => p.y + 35));
  return { ...current, offsetY: viewport.height / 2 - (top + bottom) / 2 };
}

function stablePhase(id: string): number {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967296;
}

export function plazaFlowPhase(link: PlazaWorldLink, seconds: number): number {
  return (stablePhase(link.id) + seconds * 90 / Math.max(1, link.length)) % 1;
}

function pointAtDistance(link: PlazaWorldLink, distance: number): PlazaVec3 {
  const i = Math.max(1, link.lengths.findIndex(d => d >= distance));
  const a = link.points[i - 1], b = link.points[i];
  const t = Math.max(0, Math.min(1, (distance - link.lengths[i - 1]) / Math.max(0.001, link.lengths[i] - link.lengths[i - 1])));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** A streak in WORLD distance. Changing camera projection cannot advance its phase. */
export function plazaFlowStreak(link: PlazaWorldLink, seconds: number): PlazaVec3[] {
  const head = plazaFlowPhase(link, seconds) * link.length;
  const tail = Math.max(0, head - Math.min(100, link.length * 0.2));
  return Array.from({ length: 7 }, (_, i) => pointAtDistance(link, tail + (head - tail) * i / 6));
}
