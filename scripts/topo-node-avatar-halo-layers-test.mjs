/* Round 658 — node avatar drop-shadow (3 variants: image + monogram
 * + prefix-group fallback) gains a SECOND outer drop-shadow at 8px
 * + 0x4c alpha (half R605 inner 0x99). 17th anchor in multi-layer
 * halo family — first per-node-avatar anchor (extends across all
 * 3 avatar variants in one sweep).
 *
 * Test: source-only verification — all 3 R605-family filter sites
 * now stack 2 drop-shadows.
 */
import { readFileSync } from 'node:fs';

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const pattern = /\? `drop-shadow\(0 0 4px \$\{pal\.legendAccent\}99\) drop-shadow\(0 0 8px \$\{pal\.legendAccent\}4c\) brightness\(1\.15\)`/g;
const matches = (src.match(pattern) || []).length;

const results = {
  // 3 R605-family avatar branches (image, monogram, prefix-group fallback)
  // all stack 2 drop-shadows now:
  source_three_anchors: matches === 3,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R658 node avatar multi-layer halo (3 variants in one sweep):`,
  JSON.stringify(results, null, 2),
  `\n  matches: ${matches}`);
process.exit(ok ? 0 : 1);
