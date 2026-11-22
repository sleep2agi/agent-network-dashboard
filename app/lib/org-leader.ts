type Point = { x: number; y: number };
type Box = Point & { w: number; h: number };

function edge(p: Point, b: Box): Point {
  return { x: Math.max(b.x, Math.min(b.x + b.w, p.x)), y: Math.max(b.y, Math.min(b.y + b.h, p.y)) };
}

function crosses(a: Point, b: Point, box: Box): boolean {
  let lo = 0, hi = 1;
  for (const k of ['x', 'y'] as const) {
    const v = b[k] - a[k], m = box[k] - 1, M = box[k] + (k === 'x' ? box.w : box.h) + 1;
    if (!v) { if (a[k] <= m || a[k] >= M) return false; }
    else {
      const t = (m - a[k]) / v, u = (M - a[k]) / v;
      lo = Math.max(lo, Math.min(t, u)); hi = Math.min(hi, Math.max(t, u));
      if (hi <= lo) return false;
    }
  }
  return true;
}

/** A single short bend, only when it reduces the number of obscuring cards. */
export function leaderPath(start: Point, target: Box, boxes: readonly Box[], width: number, height: number): Point[] {
  const end = edge(start, target);
  let best = [end];
  if (width >= 640 || boxes.length > 32) return best;
  const others = boxes.filter(b => b !== target);
  const directHits = others.filter(b => crosses(start, end, b)).length;
  if (!directHits) return best;
  const direct = Math.hypot(end.x - start.x, end.y - start.y);
  let hits = directHits, cost = Infinity;
  const corners: Point[] = [];
  for (const b of others) for (const x of [b.x - 4, b.x + b.w + 4]) for (const y of [b.y - 4, b.y + b.h + 4]) {
    if (x < 2 || y < 2 || x > width - 2 || y > height - 2) continue;
    const turn = { x, y }, dest = edge(turn, target);
    corners.push(turn);
    const length = Math.hypot(x - start.x, y - start.y) + Math.hypot(dest.x - x, dest.y - y);
    if (length > direct + 60 || crosses(start, turn, target)) continue;
    const count = others.filter(o => crosses(start, turn, o) || crosses(turn, dest, o)).length;
    if (count < directHits && (count < hits || (count === hits && length < cost))) {
      best = [turn, dest]; cost = length; hits = count;
    }
  }
  if (!hits) return best;
  // Only try a second corner if both exterior legs are clear. Stop at the
  // shortest unobstructed path within the same detour budget as one bend.
  const starts = corners.filter(p => !boxes.some(b => crosses(start, p, b)));
  const ends = corners.map(p => ({p, dest:edge(p,target)})).filter(({p,dest}) => !others.some(b => crosses(p,dest,b)));
  let limit = direct + 60;
  for (const a of starts) for (const {p:b,dest} of ends) {
    const length = Math.hypot(a.x-start.x,a.y-start.y) + Math.hypot(b.x-a.x,b.y-a.y) + Math.hypot(dest.x-b.x,dest.y-b.y);
    if (length >= limit || boxes.some(box => crosses(a,b,box))) continue;
    best = [a,b,dest]; limit = length;
  }
  return best;
}
