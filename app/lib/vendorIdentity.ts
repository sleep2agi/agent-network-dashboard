/** Issue #96: node visual identity — model vendor + runtime.
 *
 * Single source for two orthogonal node dimensions:
 *   - vendor : which model house powers the node (avatar body)
 *   - runtime: which execution shell it runs in (corner badge)
 *
 * Both are driven by the server `model` / `runtime` fields added in
 * commhub-server 0.8.1-preview.0 (#96 Phase 1, commit 08482ef). Old nodes
 * report `model: null` / `runtime: null` and fall back gracefully — never a
 * broken image or blank avatar.
 *
 * Adding a vendor = one entry in VENDOR_RULES. Dropping a real logo file into
 * public/vendors/ + setting `logo` lights it up with zero render-code change;
 * until then a vendor-tinted monogram stands in (not a fake official logo).
 */

export interface VendorIdentity {
  id: string;
  label: string;
  /** Monogram fallback colours, used when `logo` is null. */
  mono: { bg: string; ring: string; text: string };
  /** 1-char monogram shown when there's no logo asset. */
  initial: string;
  /** Packaged logo asset path, or null → render the monogram instead. */
  logo: string | null;
}

const UNKNOWN_VENDOR: VendorIdentity = {
  id: 'unknown',
  label: 'Unknown vendor',
  mono: { bg: 'hsl(220 10% 26%)', ring: 'hsl(220 10% 46%)', text: 'hsl(220 14% 82%)' },
  initial: '?',
  logo: null,
};

// Vendor identities, named so both the model-prefix rules and the
// runtime fallback map below can reference the same object.
const INTERN_VENDOR: VendorIdentity = {
  id: 'intern',
  label: '书生 · 上海 AI 实验室',
  mono: { bg: 'hsl(28 38% 24%)', ring: 'hsl(32 45% 52%)', text: 'hsl(34 60% 82%)' },
  initial: '书',
  // #79 shipped this asset — reuse it as the 书生 vendor logo.
  logo: '/intern_avatar.png',
};
const MINIMAX_VENDOR: VendorIdentity = {
  id: 'minimax',
  label: 'MiniMax',
  mono: { bg: 'hsl(18 50% 26%)', ring: 'hsl(18 65% 52%)', text: 'hsl(20 80% 82%)' },
  initial: 'M',
  // Official MiniMax mark (simple-icons set, CC0) on a warm-red tinted
  // badge. Vincent-authorized 2026-05-21 to use real vendor marks.
  logo: '/vendors/minimax.svg',
};
const ANTHROPIC_VENDOR: VendorIdentity = {
  id: 'anthropic',
  label: 'Anthropic',
  mono: { bg: 'hsl(16 32% 26%)', ring: 'hsl(16 48% 54%)', text: 'hsl(18 60% 84%)' },
  initial: 'A',
  // Official Anthropic mark (simple-icons set, CC0) on a warm-orange
  // tinted badge. Vincent-authorized 2026-05-21 to use real vendor marks.
  logo: '/vendors/claude.svg',
};
const OPENAI_VENDOR: VendorIdentity = {
  id: 'openai',
  label: 'OpenAI',
  mono: { bg: 'hsl(165 26% 22%)', ring: 'hsl(165 40% 44%)', text: 'hsl(165 45% 80%)' },
  initial: 'O',
  // Official OpenAI mark (simple-icons set, CC0) on a teal tinted
  // badge. Vincent-authorized 2026-05-21 to use real vendor marks.
  logo: '/vendors/openai.svg',
};

// Ordered prefix rules — first match wins. `test` runs against a lowercased
// model id. Keep the most specific prefixes first.
const VENDOR_RULES: Array<{ test: (m: string) => boolean; vendor: VendorIdentity }> = [
  { test: (m) => m.startsWith('intern'), vendor: INTERN_VENDOR },
  { test: (m) => m.startsWith('minimax'), vendor: MINIMAX_VENDOR },
  { test: (m) => m.startsWith('claude'), vendor: ANTHROPIC_VENDOR },
  {
    test: (m) => m.startsWith('gpt') || m.startsWith('codex') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4'),
    vendor: OPENAI_VENDOR,
  },
];

/* Runtime → vendor fallback. Used only when the `model` field can't
 * resolve a vendor (null or unmatched).
 *
 * Why this exists: live hub /api/status probe (2026-05-21) showed 62%
 * of sessions report `model: null` — including ALL claude-code-cli
 * nodes — so the avatar fell back to the dark "unknown vendor"
 * monogram for most of the fleet. The `runtime` field, by contrast,
 * is reliably populated. A claude-code-cli / claude-agent-sdk node is
 * an Anthropic shell; codex-sdk is OpenAI's. Deriving the vendor from
 * runtime when the model is silent lights up the vendor logo for the
 * whole fleet instead of leaving it grey. The model still wins when
 * present — runtime is strictly the fallback. */
const RUNTIME_VENDOR: Record<string, VendorIdentity> = {
  'claude-code-cli': ANTHROPIC_VENDOR,
  'claude-agent-sdk': ANTHROPIC_VENDOR,
  'codex-sdk': OPENAI_VENDOR,
};

/** Resolve a node's vendor identity. Model id wins; when the model is
 *  null or unmatched, fall back to the execution runtime. Both silent
 *  → UNKNOWN. */
export function vendorForModel(
  model: string | null | undefined,
  runtime?: string | null | undefined,
): VendorIdentity {
  if (model) {
    const m = model.toLowerCase();
    for (const rule of VENDOR_RULES) {
      if (rule.test(m)) return rule.vendor;
    }
  }
  if (runtime && RUNTIME_VENDOR[runtime]) return RUNTIME_VENDOR[runtime];
  return UNKNOWN_VENDOR;
}

export type Runtime = 'claude-code-cli' | 'codex-sdk' | 'claude-agent-sdk' | 'http-api';

export interface RuntimeIdentity {
  label: string;
  /** SVG path(s) drawn inside a 0..24 viewBox for the corner badge. */
  iconPath: string;
  /** Badge accent colour — kept clear of working/idle/offline status hues. */
  color: string;
}

const RUNTIME_MAP: Record<Runtime, RuntimeIdentity> = {
  // terminal / CLI
  'claude-code-cli': {
    label: 'Claude Code CLI',
    iconPath: 'M4 5h16v14H4z M7 9l3 3-3 3 M13 15h4',
    color: '#a78bfa',
  },
  // code-block / SDK
  'codex-sdk': {
    label: 'Codex SDK',
    iconPath: 'M9 7l-5 5 5 5 M15 7l5 5-5 5',
    color: '#38bdf8',
  },
  // SDK, distinct hue from codex
  'claude-agent-sdk': {
    label: 'Claude Agent SDK',
    iconPath: 'M4 7h16v10H4z M8 11h8 M8 14h5',
    color: '#34d399',
  },
  // cloud / API — non-resident process
  'http-api': {
    label: 'HTTP API',
    iconPath: 'M7 18a4 4 0 010-8 5 5 0 019.6-1.3A3.5 3.5 0 0118 18z',
    color: '#fbbf24',
  },
};

/** Resolve a server runtime string to badge identity. Unknown → null. */
export function runtimeIdentity(runtime: string | null | undefined): RuntimeIdentity | null {
  if (!runtime) return null;
  return RUNTIME_MAP[runtime as Runtime] ?? null;
}

/** Compact one-line identity for hover / detail surfaces:
 *  "Anthropic · claude-opus-4 · Claude Code CLI". Pieces with no data drop. */
export function identityLine(model: string | null | undefined, runtime: string | null | undefined): string {
  const v = vendorForModel(model, runtime);
  const r = runtimeIdentity(runtime);
  const parts: string[] = [];
  if (v.id !== 'unknown') parts.push(v.label);
  if (model) parts.push(model);
  if (r) parts.push(r.label);
  return parts.join(' · ');
}
