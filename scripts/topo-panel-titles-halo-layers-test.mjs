/* Round 660 · MILESTONE — recent-panel + legend-panel titles
 * drop-shadow gains a SECOND outer drop-shadow at 4px + 0x40 alpha
 * (half R550 inner 0x80). 19th anchor in multi-layer halo family
 * — covers 2 sibling panel-title surfaces in one replace_all sweep.
 *
 * Test: source-only — both panel-title filter sites stack 2 drop-
 * shadows.
 */
import { readFileSync } from 'node:fs';

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const pattern = /\? `drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 4px \$\{pal\.legendAccent\}40\) brightness\(1\.15\)` : undefined \}\}/g;
const matches = (src.match(pattern) || []).length;

const results = {
  // 2 panel titles (recent + legend) — both should match the new pattern
  source_two_titles: matches === 2,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R660 panel-titles multi-layer halo (2 sibling titles in one sweep):`,
  JSON.stringify(results, null, 2),
  `\n  matches: ${matches}`);
process.exit(ok ? 0 : 1);
