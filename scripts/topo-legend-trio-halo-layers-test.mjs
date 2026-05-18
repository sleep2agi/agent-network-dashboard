/* Round 665 — 3 legend-panel internal drop-shadow surfaces gain
 * 2nd outer drop-shadow layers in one round. 24th anchor in multi-
 * layer halo family — first legend-trio sweep.
 *
 * Surfaces: legend swatch, legend-row label, legend flow-arrow.
 */
import { readFileSync } from 'node:fs';

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceSwatch    = /`drop-shadow\(0 0 3px \$\{row\.fill\}99\) drop-shadow\(0 0 6px \$\{row\.fill\}4c\) brightness\(1\.15\)`/.test(src);
const sourceRowLabel  = /`drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 4px \$\{pal\.legendAccent\}40\) brightness\(1\.15\)`/.test(src);
const sourceFlowArrow = /`drop-shadow\(0 0 3px \$\{pal\.flowEdge\}80\) drop-shadow\(0 0 6px \$\{pal\.flowEdge\}40\) brightness\(1\.15\)`/.test(src);

const results = {
  source_swatch:     sourceSwatch,
  source_row_label:  sourceRowLabel,
  source_flow_arrow: sourceFlowArrow,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R665 legend trio multi-layer halo (3 sibling legend surfaces):`,
  JSON.stringify(results, null, 2));
process.exit(ok ? 0 : 1);
