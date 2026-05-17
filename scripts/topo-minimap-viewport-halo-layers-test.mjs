/* Round 655 — minimap viewport rect filter gains a SECOND outer
 * drop-shadow on both hover + zoom>1.5 branches. 14th anchor in
 * multi-layer halo family (1st minimap-tier anchor).
 *
 * Test phases:
 *   1. minimap only renders when zoom != 1 OR pan != 0; this test
 *      only verifies source patterns (runtime check best-effort)
 */
import { readFileSync } from 'node:fs';

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceHoverBranch = /`drop-shadow\(0 0 2px \$\{pal\.legendAccent\}99\) drop-shadow\(0 0 4px \$\{pal\.legendAccent\}4c\) brightness\(1\.15\)`/.test(src);
const sourceZoomBranch  = /`drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 4px \$\{pal\.legendAccent\}40\) brightness\(1\.15\)`/.test(src);
const sourceLayersAttr  = /data-topo-minimap-viewport-halo-layers=\{\(hoveredMinimap \|\| view\.zoom > 1\.5\) \? '2' : '0'\}/.test(src);

const results = {
  source_hover_branch: sourceHoverBranch,
  source_zoom_branch:  sourceZoomBranch,
  source_layers_attr:  sourceLayersAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R655 minimap viewport multi-layer halo (1st minimap-tier anchor):`,
  JSON.stringify(results, null, 2));
process.exit(ok ? 0 : 1);
