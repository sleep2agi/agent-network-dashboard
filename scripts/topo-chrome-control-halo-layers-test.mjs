/* Round 667 — chrome reset + fullscreen buttons gain 2-layer drop-
 * shadow halo on hover. 26th anchor in multi-layer halo family —
 * 1st chrome-control anchor.
 */
import { readFileSync } from 'node:fs';

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceResetFilter = /hoveredReset \? `drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 4px \$\{pal\.legendAccent\}40\) brightness\(1\.15\)` : undefined/.test(src);
const sourceFullscreenFilter = /hoveredFullscreen \? `drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 4px \$\{pal\.legendAccent\}40\) brightness\(1\.15\)` : undefined/.test(src);
const sourceResetAttr = /data-topo-chrome-reset-halo-layers=\{hoveredReset \? '2' : '0'\}/.test(src);
const sourceFullscreenAttr = /data-topo-chrome-fullscreen-halo-layers=\{hoveredFullscreen \? '2' : '0'\}/.test(src);

const results = {
  source_reset_filter:      sourceResetFilter,
  source_fullscreen_filter: sourceFullscreenFilter,
  source_reset_attr:        sourceResetAttr,
  source_fullscreen_attr:   sourceFullscreenAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R667 chrome controls multi-layer halo (reset + fullscreen sibling pair):`,
  JSON.stringify(results, null, 2));
process.exit(ok ? 0 : 1);
