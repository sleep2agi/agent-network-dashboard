# Dashboard Frontend Polish — Loop Rounds

> 5-minute iterative polish loop. Each round: pick one focused UI change (no
> business logic), implement, screenshot via Playwright on both themes ×
> both viewports, self-score, propose next round.
>
> Aesthetic constraints (per Vincent):
> - Minimal / restrained — NOT AI-glow heavy
> - Both Dark (Cyber) and Light themes
> - Mobile + Desktop both adapt
> - No business logic changes

---

## Round 1 — Login page polish

### What changed
- **Brand mark**: replaced flat emerald square with the existing 3-node
  mesh SVG (cyan/green/violet). The mark IS the agent-network concept
  (nodes + edges), so it doubles as both logo and visual story.
- **Tagline**: added "One control plane for your AI agents · Tasks · Mesh
  · Messages" under the H1 — answers "what is this thing" for new users
  who arrive via the OSS repo.
- **Background**: subtle dot grid in light themes (`24px 24px` radial
  dots, very low opacity) + faint radial wash. In Cyber, kept only a
  whisper of cyan/blue radial — the only "glow" allowed in the whole app.
- **Vertical layout**: tightened padding (`py-10 sm:py-16`), removed the
  ~250px dead space above the logo on desktop.
- **Footer hierarchy**: changed `Powered by Sleep2AGI` (single small
  grey line) to a 2-line block: `Powered by Sleep2AGI · Apache-2.0` then
  `anet.sh` (signals OSS + canonical home).
- **Brand mark surface**: light theme gets a soft white chip with `0 0 0
  1px var(--border)` halo; dark themes keep their navy.

### Files touched
- `app/login/page.tsx` (markup + tagline + brand SVG inline)
- `app/globals.css` (`.anet-login-bg`, `.anet-login-mark` rules at end of
  file)

### Screenshots
- `/tmp/loop-r1/light-desktop.png` ✓
- `/tmp/loop-r1/light-mobile.png` ✓
- `/tmp/loop-r1/cyber-desktop.png` ✓
- `/tmp/loop-r1/cyber-mobile.png` ✓

### Self-score: **7.8 / 10**

| Dimension                        | Score | Notes                                                                                    |
|----------------------------------|------:|------------------------------------------------------------------------------------------|
| First-impression clarity         | 9     | Tagline + mesh mark immediately tell the story                                            |
| Brand consistency                | 9     | Mark = product concept, same image across themes                                          |
| Minimal/non-AI-glow              | 8     | Cyber kept ~1 radial wash only (compromise: zero would feel flat)                         |
| Light/dark theme harmony         | 8     | Tagline + footer + form translate cleanly                                                 |
| Mobile adaptation                | 8     | Wraps fine; could shrink mark slightly on <320px screens                                  |
| Restraint (no decoration noise)  | 8     | Dot grid is borderline; if it reads as "wallpaper" I'd remove it                          |
| Affordance (what to click)       | 7     | Tabs visually OK; disabled "Sign in" button in cyber is hard to tell from active until you focus an input |

**Deductions**:
- −0.8: brand mark is static. Could pulse subtly (one node fading in/out
  on a slow 4s loop) to hint at "live agent network" — but might cross
  back into AI-glow territory. Test in round 4 maybe.
- −0.7: footer feels slightly redundant ("Apache-2.0" + "anet.sh" stacked).
  Could be `Sleep2AGI · Apache-2.0 · anet.sh` on one line.
- −0.7: form card border in cyber theme is the same `#2a2a4a` it always
  was. Could be a hair brighter to lift it off the radial wash.

### Round 2 plan: **Empty states standardization**

**Why**: with no agents/tasks/messages seeded, most pages currently show
a giant double-dash (`--`) followed by a one-liner. Examples (audit
screenshots reference):
- Overview: `-- / No agents in this network`
- Tasks: `-- / No tasks found / Tasks will appear here when agents send them via CommHub.`
- Messages: `-- / No messages / Messages between agents will appear here.`
- Nodes: `No nodes match your filters.` (no icon, no leading mark)
- Tokens: `No tokens. V3 auth required.`

The double-dash reads as a "loading" or "broken" affordance, not as an
"intentionally empty, here's how to fill it" affordance.

**Round 2 changes** (still no business logic):
- Extract a shared `<EmptyState>` component into
  `app/components/EmptyState.tsx` (or upgrade the existing
  `LoadingSkeleton.tsx` export).
- Drop the leading `--` line for an inline SVG glyph relevant to the page
  (Overview = mesh-with-no-nodes, Tasks = task-list-empty, Messages =
  bubble-empty, Nodes = nodes-grid-empty).
- Two-line copy: a calm headline + a one-liner with a CTA where it makes
  sense (e.g. Overview "No agents in this network" + "Run `anet quickstart` to register your first node →" with link to docs).
- Same icon/copy structure across both themes.

Estimated work: 30-40 min (component + 5 page integrations + screenshots).
Will start automatically on the next loop fire (`*/5`).

---

_Loop active: cron `*/5 * * * *`, job `5048a197`, session-only,
auto-expires in 7 days._

---

## Round 2 — Empty states standardization

### What changed
- **New shared component** `app/components/EmptyState.tsx`:
  - 7 variants (`nodes / tasks / messages / logs / tokens / networks /
    generic`) each with its own line-art SVG glyph (64×64 viewBox, no
    fills, thin 1.25 stroke, monochrome `currentColor`, dashed where
    appropriate to signal "incoming").
  - `<NodesEmptyState hint={...}>` keeps the Overview-specific behavior
    (cross-network global count hint) but defaults to a "Run `anet
    quickstart`" CTA when no hint is present.
  - `compact` prop for in-card empty states (Tokens, Networks).
- **Wired into 7 pages**:
  - `app/page.tsx` — Overview "no agents" → mesh-with-dashed-edges glyph
    + "Run anet quickstart →" CTA linking to anet.sh
  - `app/tasks/page.tsx` — "no tasks" → 3-bar stack glyph
  - `app/nodes/page.tsx` — "no nodes" filter-aware variant
  - `app/messages/page.tsx` — "no messages" → speech bubble outline
  - `app/logs/page.tsx` — "no audit logs" → document with lines
  - `app/settings/tokens/page.tsx` — "no API tokens" → key outline
  - `app/settings/networks/page.tsx` — "no networks" → globe-ish concentric

Every previous instance of the giant `--` text plus inconsistent
`text-gray-400 text-lg` / `text-gray-600 text-sm` patterns is gone.

### Self-score: **8.2 / 10**

| Dimension                        | Score | Notes                                                                  |
|----------------------------------|------:|------------------------------------------------------------------------|
| Visual restraint (no AI noise)   | 9     | Line-art only, no fills, no gradients, no animations                   |
| Information value per state      | 9     | Each glyph IS the entity ("messages" = bubble, "tokens" = key)         |
| Theme parity                     | 9     | currentColor + opacity bands work identically in light/dark            |
| Mobile adaptation                | 8     | All 7 pages reflow cleanly at 390×844                                  |
| Affordance (next-step CTA)       | 7     | Only Overview has a CTA right now; other pages could link to docs too  |
| Component reusability            | 9     | Single API, drops into any page in 3 lines                             |
| Old code removed cleanly         | 8     | Old `EmptyState` export in `LoadingSkeleton.tsx` is now unused (could be deleted next round) |

**Deductions**:
- −0.4: only Overview has a recovery CTA. Tasks/Messages/Logs could each
  link to a short docs anchor — but I want to confirm with Vincent
  before adding outbound link sprawl.
- −0.3: glyphs are static. The mesh-with-dashed-edges on Overview begs
  for a tiny one-shot animation (edges fade from 0.6 → 0 opacity on
  page load only — NOT a loop, that would be AI-noise). Maybe round N.
- −0.1: the old `EmptyState` export in `LoadingSkeleton.tsx` lingers,
  unused. Delete in round 3.

### Round 3 plan: **Quick Actions disambiguation**

**Why**: Overview's Quick Actions row currently mixes two intents:
```
[0/0 Nodes] [-- Tasks] [0 Failed] [→ Messages] [→ Logs] [→ Admin]
```
Three of the cells carry data ("0/0", "--", "0"), three are pure-nav
placeholders ("→"). The user can't tell at a glance which cells are
stat affordances vs nav. Worse, the data cells look like they SHOULD be
clickable for drill-in, while the nav cells look like they have no data
(false negatives).

**Round 3 changes** (no business logic):
- Split into 2 visually distinct strips on Overview:
  - **Top strip** (3 cards): pure stats — Nodes online/total, Tasks
    total, Failed tasks. Big number + label + small "view all →" link
    in corner. Hover = subtle elevation, click = navigate.
  - **Bottom row** (3 small icon-buttons): pure nav — Messages, Logs,
    Admin. Icon + label, no number, smaller affordance.
- Drop the leftover `EmptyState` export from `LoadingSkeleton.tsx`.

Estimated work: 30 min. Will fire on next `*/5` loop cycle.

---

## Round 3 — Quick Actions disambiguation

### What changed
- Overview's previous 6-cell mixed row (3 data + 3 placeholder arrows)
  is now **two intentional strips**:
  - **Stat strip** (3 cards, larger): `Nodes 0/0 · 0% online`, `Tasks 0
    · all-time`, `Failed 0 · none`. Big number on the left, "View →"
    affordance top-right, label + sub-copy below the number. Hover =
    `-translate-y-px` for a one-pixel lift.
  - **Nav rail** (3 buttons, smaller): `Messages · Audit log · Admin`
    each as icon + label, flat 12px text, no data values, neutral
    border. Clear "navigation only" affordance.
- Drop the now-unused `EmptyState` export in
  `app/components/LoadingSkeleton.tsx`; the new
  `app/components/EmptyState.tsx` is canonical.

### Self-score: **8.5 / 10**

| Dimension                | Score | Notes                                                          |
|--------------------------|------:|----------------------------------------------------------------|
| Intent clarity           | 10    | Stats above, nav below — instantly readable role               |
| Information density      | 8     | Each stat carries 3 facts (value, label, sub) without crowding |
| Affordance hierarchy     | 9     | "View →" tells you these are clickable, nav rail icons + label |
| Mobile adaptation        | 7     | 3-col stat strip at 390px is tight; numbers + "View →" squeeze |
| Theme parity             | 9     | Both render the same structure with theme-correct tokens       |
| Restraint                | 9     | No gradient washes, no icons-with-color-fills, just lines      |

**Deductions**:
- −0.7: mobile 3-col is tight at 390px. Should probably collapse to
  2-col-stat + 3-col-nav on `<sm`. Defer to next round if surfaces.
- −0.5: "0% online" sub-copy reads wrong when `total=0` (should be
  "no agents yet" or just "—"). Small copy bug, fix next round.
- −0.3: nav rail icons are 16px stroke-1.5 SVG, slightly muddy at that
  size. Bumping to 18px would help.

### Round 4 plan: **Sidebar brand + live status**

The sidebar header is still plain text:
```
Agent Network
Dashboard
```
Round 1 introduced the 3-node mesh mark on the Login page. The sidebar
should pick that up for brand continuity — users see the same visual
identifier on every page.

Add inline next to "Agent Network": a small **live status pulse** with
`{online} online · {total} total`. The pulse uses the same 24px-hub
green dot from the topology (subtle, no AI-glow). Gives every page a
real-time "is my fleet up?" signal without going to /nodes.

Estimated work: 25 min. Fires on next `*/5` loop cycle.

---

## Round 4 — Sidebar brand + live status

### What changed
- Sidebar header (used to be plain `Agent Network / Dashboard` two-line
  text) is now `BrandMark + Agent Network + status pulse`.
- **BrandMark**: same 3-node mesh SVG as `/login` (round 1), 32px in
  expanded sidebar, 28px when collapsed. Cyan ring + cyan/green/violet
  nodes use `currentColor` + Tailwind text-color classes so theming is
  automatic.
- **Live pulse**: tiny 1.5×1.5px emerald dot + copy. When online > 0 it
  animates with `anet-brand-pulse` (1.6s slow opacity drift between
  1.0 and 0.4 — NO scale, NO blur, NO glow). When `total === 0` it
  reads "no agents yet" with a grey dot, no animation. Respects
  `prefers-reduced-motion: reduce`.
- Sidebar uses SWR to poll `/api/hub/status` every 10s (dedupes with
  the Overview's existing request, so cost is zero).
- Dropped the `Dashboard` sub-label — replaced with the status line.

### Self-score: **8.6 / 10**

| Dimension                | Score | Notes                                                                       |
|--------------------------|------:|-----------------------------------------------------------------------------|
| Brand continuity         | 10    | Same mark on /login and the sidebar — first-impression to power-use loop   |
| Restraint                | 9     | Opacity-only pulse, no AI-glow; respects reduced-motion                    |
| Information density      | 9     | 3 facts (brand, online count, total) in the same vertical space as before  |
| Theme parity             | 9     | currentColor + emerald dot reads identical on both themes                  |
| Mobile + collapse        | 8     | Both states tested; 28px mark in collapsed mode reads but tight at <16px sidebar |
| Affordance               | 7     | The brand header isn't clickable; could route to /                          |

**Deductions**:
- −0.7: "no agents yet" copy feels slightly negative — "waiting for
  agents" would feel more inviting. Easy copy tweak next round.
- −0.4: brand block isn't a link. Clicking the brand on most apps
  navigates home; we should make it a `<Link href="/">`. One-line fix.
- −0.3: when sidebar is collapsed (`w-16`) the 28px mark looks small.
  Could bump to 32px in collapsed mode (the row is taller than the
  icon anyway).

### Round 5 plan: **TopoGraph light SVG variant (close issue #8)**

This is the largest open visual debt. The Command Mesh SVG bg is hard-
coded `linearGradient #0b1220 → #080814 → #101018` and the radar rings
are `#164e63`, the hub spokes are `#155e75`, the flow particles are
`#fef08a`. In Cyber that whole palette sings. In Light it's a black
square inside an otherwise white page (audit doc P1-2, GitHub issue #8).

**Round 5 changes** (no business logic):
- Detect theme via `useEffect` + `MutationObserver` on
  `document.documentElement[data-theme]`, hold in component state.
- Define two palette objects: `darkPalette` (current values) and
  `lightPalette` (white bg + subtle grey grid + emerald node + soft
  zinc edges, no glow filter).
- Pass through the SVG attribute chain. Same component, same SVG
  structure, theme-aware fills/strokes.
- Verify both themes with Playwright (+ desktop + mobile).

Estimated work: 60-80 min — the largest single round so far. Fires on
next `*/5` cycle but may span 2 cycles.
