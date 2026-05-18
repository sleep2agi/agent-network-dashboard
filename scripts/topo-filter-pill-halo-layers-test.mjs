/* Round 661 — 3 filter-pill drop-shadow surfaces gain a SECOND
 * outer drop-shadow at 6px + 30% color-mix (half R543 inner 60%).
 * 20th anchor in multi-layer halo family (1st chip/HTML-pill anchor).
 *
 * Surfaces: groupKey filter pill, vendor filter pill, status (edge)
 * filter pill — 3 sibling filter chips above the canvas.
 *
 * Test: source-only — all 3 filter-pill sites stack 2 drop-shadows
 * with color-mix(in srgb, ... 60%) → color-mix(in srgb, ... 30%)
 * falloff pattern.
 */
import { readFileSync } from 'node:fs';

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceLegendAccent = /`drop-shadow\(0 0 3px color-mix\(in srgb, \$\{pal\.legendAccent\} 60%, transparent\)\) drop-shadow\(0 0 6px color-mix\(in srgb, \$\{pal\.legendAccent\} 30%, transparent\)\)`/.test(src);
const sourceVendorColor  = /`drop-shadow\(0 0 3px color-mix\(in srgb, \$\{vendorColor\} 60%, transparent\)\) drop-shadow\(0 0 6px color-mix\(in srgb, \$\{vendorColor\} 30%, transparent\)\)`/.test(src);
const sourceFlowEdge     = /`drop-shadow\(0 0 3px color-mix\(in srgb, \$\{pal\.flowEdge\} 60%, transparent\)\) drop-shadow\(0 0 6px color-mix\(in srgb, \$\{pal\.flowEdge\} 30%, transparent\)\)`/.test(src);

const results = {
  source_legend_accent_pill: sourceLegendAccent,
  source_vendor_pill:        sourceVendorColor,
  source_flow_edge_pill:     sourceFlowEdge,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R661 filter-pill multi-layer halo (3 sibling chips in one sweep):`,
  JSON.stringify(results, null, 2));
process.exit(ok ? 0 : 1);
