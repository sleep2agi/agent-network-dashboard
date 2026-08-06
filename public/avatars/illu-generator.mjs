// R620+ / #49 goal — 24 node illustrations designed for 20px readability.
//
// Design rules (from 通信龙 dispatch, hard constraints):
//   • target readable size: 20px (not 256px)
//   • ≤ 3 shapes per avatar
//   • bold silhouette, no fine detail / no thin outlines
//   • high contrast: colored disc + near-white glyph
//   • hues wide-spaced across the set so 197 nodes distinguish easily
//   • self-verify: 20×20 downscale still recognizable → included in
//     tests/e2e-node-illu-verify/contact-sheet.svg
//
// Deliberately SVG (not webp): vector stays crisp at any raster the
// TopoGraph decides to draw, so we don't have to guess a fixed pixel
// size or ship multiple assets per avatar.
//
// Generator is a one-shot script — checked-in outputs are the shipped
// asset. Re-run only when a design tweak is needed; do NOT drive
// build from this file.

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));

// 24 hues, evenly spaced (360/24 = 15° apart).
const hueAt = (i) => (i * 15) % 360;

// Disc color: mid-lightness colored — reads as "colored" at 20px but
// not so bright it competes with the white glyph.
const disc = (i) => `hsl(${hueAt(i)} 62% 42%)`;

// Every avatar shares the same viewBox so downstream sizing is
// uniform. 100×100 gives room for the glyph to breathe; TopoGraph
// scales the whole thing anyway.
const VB = 100;
const CENTER = VB / 2;
const DISC_R = 48;

// Each entry: [name, glyphPath fn(i) → inner SVG string].
// Glyphs are one-or-two shapes over the disc. All white with strong
// contrast; a few use a translucent variant for a second sub-shape.
// Design revisions after 20px self-check:
//   slot 04 moon      → shield     (crescent + mustard disc = low contrast, replaced)
//   slot 08 wave      → arrow-up   (barbell blob at 20px, replaced)
//   slot 14 anchor    → cup        (4-shape anchor lost identity, replaced with 1-shape U)
//   slot 15 flame     → house      (pill blob at 20px, replaced)
//   slot 19 umbrella  → hourglass  (broken shape at 20px, replaced)
//   slot 21 compass   → bullseye   (bell blob at 20px, replaced with concentric solid)
const glyphs = [
  ['bolt',      () => `<path d="M55 20 L30 55 H48 L42 80 L70 42 H52 Z" fill="white"/>`],
  ['star',      () => `<polygon points="50,20 58,42 82,42 63,56 71,80 50,66 29,80 37,56 18,42 42,42" fill="white"/>`],
  ['heart',     () => `<path d="M50 78 Q22 62 22 42 Q22 26 36 26 Q45 26 50 36 Q55 26 64 26 Q78 26 78 42 Q78 62 50 78 Z" fill="white"/>`],
  ['shield',    () => `<path d="M50 20 L78 30 L78 52 Q78 72 50 82 Q22 72 22 52 L22 30 Z" fill="white"/>`],
  ['sun',       () => `<circle cx="50" cy="50" r="16" fill="white"/><g stroke="white" stroke-width="6" stroke-linecap="round"><line x1="50" y1="18" x2="50" y2="26"/><line x1="50" y1="74" x2="50" y2="82"/><line x1="18" y1="50" x2="26" y2="50"/><line x1="74" y1="50" x2="82" y2="50"/><line x1="27" y1="27" x2="33" y2="33"/><line x1="67" y1="67" x2="73" y2="73"/><line x1="73" y1="27" x2="67" y2="33"/><line x1="33" y1="67" x2="27" y2="73"/></g>`],
  ['diamond',   () => `<polygon points="50,18 78,50 50,82 22,50" fill="white"/>`],
  ['cloud',     () => `<path d="M28 58 Q28 48 38 46 Q42 34 54 34 Q66 34 68 46 Q78 46 78 58 Q78 68 68 68 H38 Q28 68 28 58 Z" fill="white"/>`],
  ['arrow-up',  () => `<path d="M50 18 L82 46 H64 V82 H36 V46 H18 Z" fill="white"/>`],
  ['triangle',  () => `<polygon points="50,20 82,74 18,74" fill="white"/>`],
  ['ring',      () => `<circle cx="50" cy="50" r="28" fill="none" stroke="white" stroke-width="12"/>`],
  ['cross',     () => `<polygon points="42,20 58,20 58,42 80,42 80,58 58,58 58,80 42,80 42,58 20,58 20,42 42,42" fill="white"/>`],
  ['xmark',     () => `<path d="M28 24 L50 46 L72 24 L76 28 L54 50 L76 72 L72 76 L50 54 L28 76 L24 72 L46 50 L24 28 Z" fill="white"/>`],
  ['crown',     () => `<path d="M22 46 L34 62 L50 42 L66 62 L78 46 L74 76 H26 Z" fill="white"/>`],
  ['cup',       () => `<path d="M22 26 H78 V56 Q78 76 50 80 Q22 76 22 56 Z" fill="white"/>`],
  ['house',     () => `<polygon points="50,18 84,48 74,48 74,82 26,82 26,48 16,48" fill="white"/>`],
  ['leaf',      () => `<path d="M22 78 Q22 30 78 22 Q78 78 22 78 Z" fill="white"/><path d="M30 72 L70 32" stroke="hsl(0 0% 35%)" stroke-width="4" stroke-linecap="round"/>`],
  ['fish',      () => `<path d="M20 50 Q34 26 60 34 Q78 40 80 50 Q78 60 60 66 Q34 74 20 50 Z" fill="white"/><polygon points="14,38 24,50 14,62" fill="white"/>`],
  ['music',     () => `<circle cx="34" cy="70" r="10" fill="white"/><rect x="42" y="24" width="6" height="46" fill="white"/><path d="M42 24 L72 18 L72 34 L42 40 Z" fill="white"/>`],
  ['hourglass', () => `<path d="M22 18 H78 L58 50 L78 82 H22 L42 50 Z" fill="white"/>`],
  ['rocket',    () => `<path d="M50 18 Q64 34 64 56 L64 74 L36 74 L36 56 Q36 34 50 18 Z" fill="white"/><polygon points="36,66 24,80 36,78" fill="white"/><polygon points="64,66 76,80 64,78" fill="white"/><circle cx="50" cy="46" r="6" fill="hsl(0 0% 30%)"/>`],
  ['bullseye',  () => `<circle cx="50" cy="50" r="30" fill="white"/><circle cx="50" cy="50" r="20" fill="hsl(0 0% 25%)"/><circle cx="50" cy="50" r="10" fill="white"/>`],
  ['ghost',     () => `<path d="M22 44 Q22 22 50 22 Q78 22 78 44 L78 76 L68 68 L58 76 L50 68 L42 76 L32 68 L22 76 Z" fill="white"/><circle cx="40" cy="46" r="5" fill="hsl(0 0% 25%)"/><circle cx="60" cy="46" r="5" fill="hsl(0 0% 25%)"/>`],
  ['cat',       () => `<polygon points="22,22 34,52 18,50" fill="white"/><polygon points="78,22 82,50 66,52" fill="white"/><path d="M22 50 Q22 78 50 80 Q78 78 78 50 Q78 32 50 34 Q22 32 22 50 Z" fill="white"/><circle cx="42" cy="58" r="4" fill="hsl(0 0% 25%)"/><circle cx="58" cy="58" r="4" fill="hsl(0 0% 25%)"/>`],
  ['gem',       () => `<polygon points="50,18 78,38 68,80 32,80 22,38" fill="white"/><line x1="22" y1="38" x2="78" y2="38" stroke="hsl(0 0% 25%)" stroke-width="3"/><line x1="50" y1="18" x2="50" y2="38" stroke="hsl(0 0% 25%)" stroke-width="3"/>`],
];

if (glyphs.length < 24) throw new Error(`need 24+ glyphs, have ${glyphs.length}`);

const svg = (i, name, glyphInner) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}" width="${VB}" height="${VB}">
  <!-- illu-${String(i + 1).padStart(2, '0')} · ${name} · hue ${hueAt(i)} -->
  <circle cx="${CENTER}" cy="${CENTER}" r="${DISC_R}" fill="${disc(i)}"/>
  ${glyphInner}
</svg>
`;

// Write 24 files
for (let i = 0; i < 24; i++) {
  const [name, g] = glyphs[i];
  const idx = String(i + 1).padStart(2, '0');
  const out = join(OUT, `illu-${idx}.svg`);
  writeFileSync(out, svg(i, name, g()));
}

console.log(`Wrote ${glyphs.length} SVG illustrations to ${OUT}/illu-*.svg`);
console.log(`Hues cycle every ${360 / glyphs.length}°; disc HSL is (hue, 62%, 42%).`);
