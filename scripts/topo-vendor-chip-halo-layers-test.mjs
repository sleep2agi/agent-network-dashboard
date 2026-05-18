/* Round 663 — vendor chip filter gains a 2nd outer drop-shadow at
 * 6px with halved color-mix opacity on both pin (60%→30%) + hover
 * (40%→20%) branches. 22nd anchor in multi-layer halo family.
 */
import { readFileSync } from 'node:fs';

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourcePin = /`drop-shadow\(0 0 3px color-mix\(in srgb, \$\{v\.color\} 60%, transparent\)\) drop-shadow\(0 0 6px color-mix\(in srgb, \$\{v\.color\} 30%, transparent\)\) brightness\(1\.15\)`/.test(src);
const sourceHover = /`drop-shadow\(0 0 3px color-mix\(in srgb, \$\{v\.color\} 40%, transparent\)\) drop-shadow\(0 0 6px color-mix\(in srgb, \$\{v\.color\} 20%, transparent\)\) brightness\(1\.15\)`/.test(src);

const results = {
  source_pin_branch:   sourcePin,
  source_hover_branch: sourceHover,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R663 vendor chip multi-layer halo (pin + hover branches):`,
  JSON.stringify(results, null, 2));
process.exit(ok ? 0 : 1);
