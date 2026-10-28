import { PLAZA_LABEL_WIDTH } from './plaza-perspective';

export interface PlazaLabelAnchor { id: string; x: number; y: number; depth: number; agents: number }
export interface PlazaLabelRect { x: number; y: number; width: number; height: number }
export interface PlazaLabel extends PlazaLabelRect { id: string; rows: number }
const GAP = 8;
const EDGE = 12;
// Keep pointer-driven layout bounded. Every department remains in the scene and selector.
const MAX_LABELS = 48;

export function plazaLabelsOverlap(a: PlazaLabelRect, b: PlazaLabelRect, gap = 0) {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

/** Move only upright namecards. World geometry, camera and flow phase are untouched. */
export function layoutPlazaLabels(anchors: PlazaLabelAnchor[], viewport: { width: number; height: number },
  core: PlazaLabelRect, selected: string | null) {
  const dense = anchors.length > 8;
  const labels = new Map<string, PlazaLabel>();
  const occupied: PlazaLabelRect[] = [core];
  let compactSlots: PlazaLabelRect[] | null = null;
  const ordered = [...anchors].sort((a, b) => Number(b.id === selected) - Number(a.id === selected)
    || b.depth - a.depth || a.id.localeCompare(b.id));
  const fit = (anchor: PlazaLabelAnchor, rows: number, width: number): PlazaLabel | null => {
    const height = 64 + Math.max(1, Math.min(anchor.agents, rows)) * 33;
    const maxX = viewport.width - EDGE - width, maxY = viewport.height - EDGE - height;
    if (maxX < EDGE || maxY < EDGE) return null;
    const clampX = (x: number) => Math.max(EDGE, Math.min(maxX, x));
    const clampY = (y: number) => Math.max(EDGE, Math.min(maxY, y));
    const x = clampX(anchor.x - width / 2), y = clampY(anchor.y - height - 8);
    const preferred = { id: anchor.id, x, y, width, height, rows };
    if (!occupied.some(r => plazaLabelsOverlap(preferred, r, GAP))) return preferred;
    // Candidate edges include already placed labels, avoiding iterative forces or RAF drift.
    const xs = [...new Set([x, EDGE, maxX, ...occupied.flatMap(r => [r.x - width - GAP, r.x + r.width + GAP]).map(clampX)])];
    const ys = [...new Set([y, EDGE, maxY, ...occupied.flatMap(r => [r.y - height - GAP, r.y + r.height + GAP]).map(clampY)])];
    let best: PlazaLabel | null = null, score = Infinity;
    for (const cx of xs) for (const cy of ys) {
      const distance = (cx - x) ** 2 + (cy - y) ** 2;
      if (distance >= score) continue;
      const candidate = { ...preferred, x: cx, y: cy };
      if (occupied.some(r => plazaLabelsOverlap(candidate, r, GAP))) continue;
      best = candidate; score = distance;
    }
    return best;
  };
  const slots = (width: number) => {
    const height = 97, bottom = viewport.height - EDGE;
    const columns = Math.max(1, Math.floor((viewport.width - EDGE * 2 + GAP) / (width + GAP)));
    const result: PlazaLabelRect[] = [];
    for (let column = 0; column < columns; column++) {
      const x = columns === 1 ? (viewport.width - width) / 2
        : EDGE + column * (viewport.width - EDGE * 2 - width) / (columns - 1);
      const blockers = occupied.filter(r => x < r.x + r.width + GAP && x + width + GAP > r.x)
        .map(r => ({ top: Math.max(EDGE, r.y - GAP), bottom: Math.min(bottom, r.y + r.height + GAP) }))
        .filter(r => r.bottom > EDGE && r.top < bottom).sort((a, b) => a.top - b.top);
      let y = EDGE;
      for (const blocker of [...blockers, { top: bottom, bottom }]) {
        while (y + height <= blocker.top) { result.push({ x, y, width, height }); y += height + GAP; }
        y = Math.max(y, blocker.bottom);
      }
    }
    return result;
  };
  for (const anchor of ordered) {
    const active = anchor.id === selected;
    if (labels.size >= MAX_LABELS) break;
    // Offscreen platforms do not pull all their cards into the viewport during panning.
    if (!active && (anchor.x < 0 || anchor.x > viewport.width || anchor.y < 0 || anchor.y > viewport.height)) continue;
    const width = Math.min(active || !dense ? PLAZA_LABEL_WIDTH : 190, viewport.width - EDGE * 2);
    const rows = active ? 6 : dense ? 1 : 4;
    let label: PlazaLabel | null;
    if (dense && !active) {
      // Compact labels share aligned columns. Packing free vertical intervals
      // avoids the unusable fragments left by greedy free-position rectangles.
      compactSlots ??= slots(width);
      const distance = (r: PlazaLabelRect) => (r.x + r.width / 2 - anchor.x) ** 2 + (r.y + r.height + 8 - anchor.y) ** 2;
      let nearest = 0;
      for (let i = 1; i < compactSlots.length; i++) if (distance(compactSlots[i]) < distance(compactSlots[nearest])) nearest = i;
      const slot = compactSlots.splice(nearest, 1)[0];
      label = slot ? { ...slot, id: anchor.id, rows } : null;
    } else {
      label = fit(anchor, rows, width);
      // A 580px mobile scene can have too little room above/below the core for
      // six rows after panning. Keep the selected card accessible with fewer
      // rows; its +N footer and the complete roster still expose every node.
      if (active) for (let visible = rows - 1; visible >= 1 && !label; visible--) label = fit(anchor, visible, width);
      else label ??= fit(anchor, 1, width);
    }
    if (label) { labels.set(anchor.id, label); occupied.push(label); }
  }
  return { labels, dense, hidden: anchors.length - labels.size };
}
