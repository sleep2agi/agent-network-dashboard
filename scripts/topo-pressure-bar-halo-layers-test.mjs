/* Round 662 — pressure-bar segment filter gains a 2nd outer drop-
 * shadow at 4px + 0x4c alpha (half R542 inner 0x99). 21st anchor
 * in multi-layer halo family (1st chip-bar anchor).
 *
 * Test: source-only — filter expression stacks 2 drop-shadows with
 * tier-color (${color}) at 99 → 4c falloff.
 */
import { readFileSync } from 'node:fs';

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /isSegLit \? `brightness\(1\.2\) drop-shadow\(0 0 2px \$\{color\}99\) drop-shadow\(0 0 4px \$\{color\}4c\)` : undefined/.test(src);

const results = {
  source_filter: sourceFilter,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R662 pressure-bar segment multi-layer halo (1st chip-bar anchor):`,
  JSON.stringify(results, null, 2));
process.exit(ok ? 0 : 1);
