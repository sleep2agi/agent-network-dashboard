/* Round 377 verification: FreshnessChip baseClass picks up `tabular-
 * nums`. The chip-row's last untouched chip joins the R224-R357
 * tabular-nums sweep. `font-mono` already gave equal-width glyphs;
 * R377 adds the explicit invariant the rest of the chip row carries.
 *
 * The chip only renders when stale (R275 gate: sec > 10s since
 * last SWR sync). Test verifies the source-file invariant directly
 * (className contains 'tabular-nums') since simulating > 10 s of
 * no SWR refresh in a Playwright test is brittle.
 *
 * Contract:
 *   - Source file TopoGraph.tsx contains the new baseClass with
 *     'tabular-nums' between 'font-medium' and 'border'.
 *   - Source file mentions R377 round marker.
 *   - All preserved invariants: font-mono, font-medium (R313/R315),
 *     transition-colors duration-300 (R187), rounded-md, border.
 */
import { readFileSync } from 'node:fs';

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');

const baseClassLineMatch = src.match(/const baseClass = "([^"]+)"/);
const baseClass = baseClassLineMatch?.[1] ?? '';

const results = {
  source_has_baseclass:       !!baseClassLineMatch,
  baseclass_has_tabular_nums: /\btabular-nums\b/.test(baseClass),
  baseclass_has_font_mono:    /\bfont-mono\b/.test(baseClass),
  baseclass_has_font_medium:  /\bfont-medium\b/.test(baseClass),
  baseclass_has_rounded_md:   /\brounded-md\b/.test(baseClass),
  baseclass_has_border:       /\bborder\b/.test(baseClass),
  baseclass_has_transition:   /\btransition-colors\b/.test(baseClass),
  baseclass_duration_300:     /\bduration-300\b/.test(baseClass),
  // Ensure ordering: font-medium → tabular-nums → border.
  ordering_correct:           /font-medium tabular-nums border/.test(baseClass),
  round_marker_present:       /Round 377 \/ Loop/.test(src),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} FreshnessChip baseClass tabular-nums:`, JSON.stringify(results),
  '\n  baseClass:', baseClass);
process.exit(ok ? 0 : 1);
