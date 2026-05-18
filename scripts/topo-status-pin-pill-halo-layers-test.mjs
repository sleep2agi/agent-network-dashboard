/* Round 664 — status filter pin pill drop-shadow gains a 2nd outer
 * layer at 6px + 0x4c alpha. 23rd anchor in multi-layer halo family
 * (4th chip-row tier anchor, completing the chip-row tier).
 */
import { readFileSync } from 'node:fs';

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
// Source carries a 2-drop-shadow chain in the status pin pill filter
const sourceTwoDropShadows = /\}99\) drop-shadow\(0 0 6px \$\{[\s\S]{0,400}\}4c\)/.test(src);

const results = {
  source_two_drop_shadows: sourceTwoDropShadows,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R664 status filter pin pill multi-layer halo (completes chip-row tier 4/4):`,
  JSON.stringify(results, null, 2));
process.exit(ok ? 0 : 1);
