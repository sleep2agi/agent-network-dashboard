/**
 * TopoGraph is a Dashboard-owned canvas. The desktop client has no
 * topology view to copy, so these locks keep the ownership stamp and
 * the layout / halo / rename / empty-state fixes from drifting back.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../app/components/TopoGraph.tsx', import.meta.url), 'utf8');
const count = (needle) => src.split(needle).length - 1;

assert.equal(src.includes("const TOPO_REVISION = 'dashboard-topo-2026-10-11'"), true);
assert.equal(count('data-topo-maintainer="dashboard"'), 3);
assert.equal(src.includes('Dashboard 单独维护'), true);
assert.equal(src.includes('data-topo-ghost-empty="true"'), true);
assert.equal(src.includes("drawnNodeCount === 0 ? 'empty'"), true);
assert.equal(src.includes('data-node-halo-offline-opacity={isOnline ? undefined : haloRest}'), true);
assert.equal(src.includes('setPinnedEdgeKey(prev => retargetEdgeKey(prev, from, to))'), true);
assert.equal(src.includes('ringContentBox: contentBoxOf(positions, 64)'), true);

assert.equal(count('hover:bg-white/5'), 2, 'TopoGraph hover:bg-white/5 comment mentions');
assert.equal(count('active:bg-white/10'), 1, 'TopoGraph active:bg-white/10 comment mention');
assert.equal(count('active:bg-[var(--hover-tint-strong)]'), 3, 'TopoGraph active tints');

function polarPoint(index, total, radius, rotateBy = 0) {
  const cx = 500;
  const cy = 330;
  const spread = total <= 2 ? Math.PI : Math.PI * 1.78;
  const start = -Math.PI / 2 - spread / 2;
  const angle = total <= 1 ? -Math.PI / 2 : start + (spread * index) / (total - 1) + rotateBy;
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

function contentBoxOf(positions, pad) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const pts = Object.values(positions);
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

function retargetEdgeKey(key, from, to) {
  if (!key) return key;
  const sep = '->';
  const at = key.indexOf(sep);
  if (at < 0) return key;
  const a = key.slice(0, at);
  const b = key.slice(at + sep.length);
  if (a !== from && b !== from) return key;
  return `${a === from ? to : a}${sep}${b === from ? to : b}`;
}

const positions = {};
const offlineR = 325 + Math.max(0, 20 - 4) * 6;
for (let i = 0; i < 20; i++) positions['n' + i] = polarPoint(i, 20, offlineR, 0);
const box = contentBoxOf(positions, 64);
assert.ok(box.y < 8 || box.y + box.h > 680 - 8, '20 offline nodes leave the ring viewBox');

const VIEWBOX_W = 1000;
const VIEWBOX_H = 680;
const pad = 16;
const z = Math.max(0.5, Math.min(1, (VIEWBOX_W - 2 * pad) / box.w, (VIEWBOX_H - 2 * pad) / box.h));
assert.ok(z < 1, 'fit zoom scales a grown offline ring');
const top = VIEWBOX_H / 2 - (box.y + box.h / 2) * z + box.y * z;
const bottom = top + box.h * z;
assert.ok(top >= pad - 1 && bottom <= VIEWBOX_H - pad + 1, 'fitted ring stays inside the frame');

assert.equal(retargetEdgeKey('通信龙->通信牛', '通信龙', '通信虎'), '通信虎->通信牛');
assert.equal(retargetEdgeKey('通信牛->通信龙', '通信龙', '通信虎'), '通信牛->通信虎');
assert.equal(retargetEdgeKey('甲->乙', '通信龙', '通信虎'), '甲->乙');

console.log('topo dashboard-owned: PASS');
