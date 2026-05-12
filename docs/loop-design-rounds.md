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

---

## Round 5 — TopoGraph light SVG variant · closes issue #8

### What changed
- Added a `useTheme()` hook that watches `data-theme` on
  `document.documentElement` via `useEffect + MutationObserver`. Returns
  `'light'` for `light/mint` themes, `'dark'` for `cyber/sunset`.
- Defined two `Palette` objects (DARK_PALETTE, LIGHT_PALETTE) covering
  panel gradient stops, radar wash colors, arrow fill, ring stroke,
  spoke stroke (active + idle), flow edge, flow path, flow particle,
  node fills (online + offline), label-box + legend-box backgrounds,
  legend text/headline/accent, container bg + border, top-rail gradient
  Tailwind tokens.
- Threaded the palette through every hardcoded color in the SVG:
  - `linearGradient #topo-panel` stops
  - `radialGradient #topo-radar` stops
  - `filter #topo-glow` is now **omitted** in light (no Gaussian blur
    halo — that's the AI-glow risk vector)
  - `marker #topo-arrow` fill
  - radar rings + radial lines stroke + opacity
  - hub link spokes (active + idle)
  - directed message flow edges (with conditional `filter` for glow)
  - node fill (online vs offline), halo, status indicator
  - node label box rect fill + stroke
  - "recent signal" + "legend" boxes (fill, stroke, text colors)
- `nodeStatus(session, isOnline, isLight)` now also returns
  theme-appropriate `primary / halo / text` triplets — emerald/teal/
  zinc in light, neon cyan/green in dark.

### Files touched
- `app/components/TopoGraph.tsx` — single file, ~50 LOC added (palette
  + theme hook), ~20 hardcoded colors replaced with palette refs.

### Screenshots
- `/tmp/loop-r5/light-desktop.png` ✓ — white-ish panel, faint emerald
  wash, light grey radar rings, calm legend boxes, no glow halos
- `/tmp/loop-r5/cyber-desktop.png` ✓ — unchanged from 0.4.4 (verified
  no regression)
- `/tmp/loop-r5/light-mobile.png` ✓ — "Show Topology" toggle (existing
  mobile gate behavior preserved)
- `/tmp/loop-r5/cyber-mobile.png` ✓

### Self-score: **9.0 / 10**

| Dimension                | Score | Notes                                                                          |
|--------------------------|------:|--------------------------------------------------------------------------------|
| Issue #8 closure         | 10    | Light theme TopoGraph no longer reads as a black square                       |
| No Cyber regression      | 10    | Dark theme renders byte-identically; same palette values flow through         |
| Restraint (AI-glow)      | 9     | Dropped `filter #topo-glow` in light — flat strokes only, no Gaussian halos   |
| Theme detection robust   | 9     | MutationObserver catches runtime theme switches (live), not just initial paint |
| Mobile parity            | 9     | Mobile mock gate ("topology hidden") preserved; if user shows it, both work   |
| Code organization        | 8     | Palette objects + hook are tidy; some hub-pulse `#10b981` literal still inline |

**Deductions**:
- −0.5: "idle-5" offline node label box overlaps the center pulse hub
  when offline-row positioning algorithm puts that node high. Pre-
  existing layout bug, surfaced more clearly in light. Future round
  could add layout collision avoidance.
- −0.3: radar wash opacity 0.06 is very subtle in light. Might want
  0.08–0.10 for slightly more depth. Tune in a future round.
- −0.2: the 24px pulse hub (from 0.4.3-preview.1) uses `#10b981`
  literal directly. Works in both themes by accident. Should be
  palette-driven.

### Round 6 plan: **Settings section grouping + License chip**

The Settings page (audit P1-1) is currently a long flat list:
```
CommHub Connection
Server Info
Dashboard
License
Change Password
API Tokens
Networks
Session
```
Each is a separately-bordered card with no visual hierarchy. The user
can't tell at a glance which sections are "connection-y", "account-y",
or "advanced-y".

**Round 6 changes** (no business logic):
- Wrap the cards into 3 logical groups with small uppercase section
  headings:
  - **Connection** → CommHub Connection + Server Info + Dashboard
  - **Account** → License + Change Password + Session
  - **Resources** → API Tokens + Networks
- License "trial" text → a proper amber pill ("trial • 14 days left").
- Session card: tone down the red headline (looks like an error).
  "Session" → "Sign out", red → neutral grey, red `Sign out` button →
  ghost outline.

Estimated work: 25 min. Fires next `*/5`.

---

## Round 6 — Settings section grouping + License chip + Session tone

### What changed
- Wrapped the 8 settings cards into **3 logical groups** with small
  uppercase `text-[10px] tracking-[0.12em]` section labels:
  - **CONNECTION** — CommHub Connection, Server Info, Dashboard
  - **ACCOUNT** — License, Change Password, Sign out
  - **RESOURCES** — API Tokens + Networks (2-col grid)
- **License chip**: added inline next to "License" headline. A pill
  showing `● {type} · {days_left}d left` with theme-aware coloring —
  green for pro, red when ≤7 days, amber otherwise. Replaces the
  isolated orange `trial` text inside the value rows.
- **Session card** (audit P3 finding): renamed "Session" → "Sign out"
  with neutral grey card border and copy ("Signing out clears your
  dashboard session cookie. You'll return to the login page."). Red
  pill button → ghost outline matching the rest of the surface. No
  longer reads as a "danger zone" warning.
- Left the legacy red-Session section in place but `display: none` so
  it can be removed cleanly in round 7's cleanup pass.

### Self-score: **8.8 / 10**

| Dimension                | Score | Notes                                                                |
|--------------------------|------:|----------------------------------------------------------------------|
| Hierarchy                | 9     | Three small caps headings give instant orientation                  |
| License presentation     | 9     | Chip is calm and theme-aware; matches the rest of the chip system   |
| Session tone             | 9     | No longer looks like a danger zone; reads as a quiet utility action |
| Theme parity             | 9     | Headings use `text-gray-600` which themes via the shim correctly    |
| Hidden cruft             | 7     | Legacy red Session section still in DOM (display:none) — clean next round |
| Information dedup        | 8     | License chip + "Type: trial" row carry the same info; row could go  |

**Deductions**:
- −0.5: License chip duplicates "Type" row info. Remove the row in
  round 7 so the chip is the canonical source of truth.
- −0.4: hidden legacy `Session` section is still in the DOM (`hidden`
  class). Delete fully in round 7.
- −0.3: section labels (`CONNECTION / ACCOUNT / RESOURCES`) might
  benefit from a thin horizontal rule underneath when each group
  has 2+ cards. Tiny polish.

### Round 7 plan: **Small wins batch**

Bundle the lingering deductions from rounds 1, 2, 4, 6:
- **Login footer one-line**: collapse `Powered by Sleep2AGI · Apache-2.0
  / anet.sh` to a single muted line `Sleep2AGI · Apache-2.0 · anet.sh`
- **Sidebar brand**: wrap in `<Link href="/">` so clicking the brand
  goes home (common app convention; round 4 deduction)
- **Sidebar status copy**: `no agents yet` → `waiting for agents` —
  feels more inviting, less negative (round 4 deduction)
- **License row de-dup**: remove the standalone `Type / trial` row
  inside the License card now that the chip carries that fact
- **Settings cleanup**: delete the `display:none` legacy Session card

All are <5 LOC each, batch is ~25 LOC total. Fires next `*/5`.

---

## Round 7 — Small-wins batch

### What changed
- **Login footer**: collapsed `Powered by Sleep2AGI · Apache-2.0 /
  anet.sh` (two lines) to a single muted line `Sleep2AGI · Apache-2.0
  · anet.sh`. `anet.sh` is an outbound `<a>` with hover affordance.
- **Sidebar brand**: wrapped the brand block in `<Link href="/">` —
  clicking the brand mark or product name navigates to Overview, the
  standard app convention. Subtle hover (`hover:bg-[#11112a]/40` in
  expanded; `hover:opacity-80` when collapsed).
- **Sidebar copy**: `no agents yet` → `waiting for agents`. Feels
  inviting (the system is ready, awaiting input) rather than
  negative (nothing is here yet).
- **License row de-dup**: removed the standalone `Type: trial` and
  `Days Left: 14 days` rows from the License card. The header chip
  is now the canonical source of truth for license status. Only the
  expiring-soon warning row remains, and only when ≤7 days left.
- **Settings cleanup**: deleted the `display:none` legacy red Session
  section. The neutral Sign out card inside the ACCOUNT group is now
  the only sign-out surface.

### Self-score: **8.4 / 10**

| Dimension              | Score | Notes                                                          |
|------------------------|------:|----------------------------------------------------------------|
| Deductions cleared     | 9     | All 5 lingering items from rounds 1, 2, 4, 6 are now resolved  |
| Visible-impact         | 6     | Mostly cleanup, low "wow" — but eliminates accumulated debt    |
| Theme parity           | 9     | Each change works identically in light + cyber                 |
| Code reduction         | 8     | Net -15 LOC after removing legacy Session + dup License rows   |

**Deductions**:
- −0.9: low individual-change visibility — this batch reads more as
  "removed papercuts" than "added delight". That's by design (rounds
  1-6 spent most of the visible-delight budget), but tone is muted.
- −0.4: didn't include a `<title>` attribute on the brand `<Link>` so
  hover doesn't tooltip "Home". One-line miss.
- −0.3: didn't address the round 5 deduction about the offline-node
  label box overlapping the center pulse hub — that needs layout
  algorithm work, defer to a layout-focused round.

### Round 8 plan: **Ship 0.4.5-preview.0**

7 rounds of polish accumulated since 0.4.4-preview.0:
- `b702291` round 1 — login brand mark + tagline + restrained surface
- `64643a3` round 2 — empty states across 7 pages (line-art glyphs)
- `269eeb3` round 3 — Quick Actions split (stats + nav)
- `4721d60` round 4 — sidebar brand mark + live pulse
- `0011eb5` round 5 — TopoGraph light SVG variant (closes #8)
- `6fe0aa3` round 6 — Settings section grouping + License chip
- (round 7 commit, this one) — small-wins batch

Natural ship-point. Round 8 = the publish itself:
1. Bump `package.json` 0.4.4 → 0.4.5-preview.0
2. `npm publish --tag preview` (prepublishOnly hook will rebuild)
3. Push to GitHub via PAT
4. Tell 通信龙 to bump CLI preview's PINNED_DASHBOARD_VERSION
5. Telegram Vincent: `npm i -g @sleep2agi/agent-network@preview`

After ship, rounds 9+ accumulate toward the **next** preview in the
SAME `0.4.5-preview.N` series (Vincent's policy: don't burn base version
numbers on preview-only work). Backlog ideas: layout collision
avoidance in TopoGraph, hover affordances on KPI cards, Cmd+K command
palette, header health banner, mobile audit.

> **Version policy (round 8 + Vincent telegram)**: stable stays at
> `0.4.2` until Vincent explicitly promotes a preview. All new previews
> bump only the `-preview.N` suffix on the same `0.4.5` base. The
> `latest` npm tag never moves without sign-off.

---

## Round 9 — Header health banner

### What changed
- New `app/components/HealthBanner.tsx`: thin sticky strip mounted in
  `AppShell` between sidebar and page content, visible on every
  non-login page.
- Three states, priority-ranked:
  - **red** — `CommHub unreachable — agents may be offline` + CTA
    "Open Settings →"
  - **amber** — `N task(s) failed recently` + CTA "Review failures →"
    (links to `/tasks?status=failed`). Dot pulses with the same 1.6s
    opacity drift as the sidebar online pulse.
  - **green** — `All systems go`. Quiet. No CTA. Doesn't render until
    at least one stats response confirms (avoids flashing green on
    first paint before data arrives).
- Pulls from `/api/hub/stats` + `/api/hub/health` via SWR (15s refresh,
  5s dedupe). Both endpoints are already polled elsewhere — request
  dedupes free, banner has zero net cost.
- Dismissible per-session via `sessionStorage.anet-hb-dismissed = '1'`.
  Re-shows on next session.
- Light/mint themes get bumped color saturation via `.anet-health-banner`
  override rules in globals.css so red/amber/green read crisply on
  white surfaces.

### Self-score: **8.7 / 10**

| Dimension                | Score | Notes                                                                  |
|--------------------------|------:|------------------------------------------------------------------------|
| Information value        | 9     | Fleet health visible from every page without navigating to /nodes      |
| Restraint                | 9     | 32px-tall strip; opacity-only pulse; no glow; auto-dismissible         |
| Affordance (CTAs)        | 9     | Each non-green state has a clear "fix this" link                       |
| Theme parity             | 9     | All 3 states verified in light + cyber                                 |
| Failure-state robustness | 8     | "Red" fires only when both `/stats` AND `/health` fail; safer than either alone |
| Mobile                   | 7     | Strip wraps at 390px viewport; could collapse "Review failures →" copy further |

**Deductions**:
- −0.6: on very narrow mobile (<340px) the CTA + dismiss can wrap or
  overlap. Could collapse CTA to icon-only at that breakpoint.
- −0.4: red state has a single message; doesn't distinguish "hub down"
  vs "auth expired" vs "network error". Future round could add error
  classification.
- −0.3: dismiss is session-scoped. Some users may want
  "dismiss for this session only" vs "dismiss forever". Defer.

### Round 10 plan: **KPI card rich hover preview**

Overview's stat strip (round 3) shows top-level numbers — `Nodes 4/5`,
`Tasks 0`, `Failed 0` — but a power user wants to see the breakdown
without clicking through. Add small CSS-only popovers that appear on
hover:
- Nodes hover → "3 working · 2 idle · 0 offline"
- Tasks hover → "by status: 4 running, 2 replied, 1 failed, 0 expired"
- Failed hover → "5 in last hour · last failure 12m ago"

Pure CSS popover (no JS state), 200ms delay-show, fades out on
unhover. Both themes. Doesn't affect mobile (touch shows full card
already).

Estimated work: 25 min. Fires next `*/5`.

---

## Round 10 — KPI card rich hover preview

### What changed
- The 3-stat strip on Overview (Nodes / Tasks / Failed) now gets a
  **hover popover** showing the breakdown that the headline number
  abstracts away.
  - **Nodes** hover → `● working {n}` / `● idle {n}` / `● offline {n}`
  - **Tasks** hover → list of all populated statuses in priority
    order (running → replied → failed → cancelled → expired → closed
    → created → delivered → acked), each with its color dot + count
  - **Failed** hover → `no failures yet` or `{n} in current view`
- **Pure CSS** popover: hidden by default, `opacity-0 translate-y-[-2px]`
  transitions to `opacity-100 translate-y-0` on `group-hover`. 100ms
  delay-show so a quick mouse-pass doesn't flicker. No React state.
- `pointer-events-none` on the popover so it never intercepts the
  click through to the underlying Link target.
- **Mobile gate**: `hidden md:block` — touch devices don't get the
  popover (no `:hover`). The card itself still navigates on tap, so no
  functionality lost.
- Dot colors inlined as hex (`#4ade80` green, `#a78bfa` purple, etc.)
  to dodge Tailwind's purge of dynamic `bg-${family}-400` class names.

### Self-score: **8.5 / 10**

**Deductions**: no `:focus-within` trigger (keyboard users miss
popover); "Failed" copy doesn't show time bucket; dot hex inlined
rather than centralized in a constants palette.

### Round 11 plan: **Mobile audit + polish pass**

Nine rounds in, the desktop story is solid. Mobile hasn't gotten a
dedicated round since the initial audit. Likely findings:

- Health banner at <340px: CTA + dismiss button + truncated message
  competes for ~280px usable width. Collapse CTA to icon-only or
  move it below the message.
- Stat strip 3-col at 360-390px: "View →" affordance shrinks below
  legibility. Either drop "View →" on mobile or stack 1-col.
- Sidebar mobile drawer: not screenshot-audited against the latest
  brand-mark + pulse changes.
- Footer text spacing on /login at 320px: wraps awkwardly.

Action: capture mobile screenshots across 5-6 key pages at 390×844
AND 360×740, identify worst offenders, fix the top 3.

Estimated work: 30 min. Fires next `*/5`.

---

## Round 11 — Mobile audit + polish pass

### Findings (390×844 + 360×740)
Captured 12 screenshots (6 pages × 2 themes × 2 viewports). Three
clear regressions at narrow widths:

1. **Health banner** ran into the fixed-position hamburger button at
   top-left (top:4 left:3, ~44×44 hit area). Message text was
   truncated to "...sks failed recently" because the leading 6
   characters sat under the hamburger.
2. **UserBar** "Edit" + "Sign out" text links cramped against the
   user name + role on narrow screens, wrapping "Sign out" onto
   two lines.
3. **Stat strip** "View →" affordance in each card's top-right took
   horizontal space the headline number needed, making the 3-col
   grid feel cramped at 360px.

### What changed
- **HealthBanner**: `pl-3` → `pl-14` on mobile (clears the hamburger
  button), CTA text "Review failures" / "Open Settings" collapses to
  a bare arrow on `<sm` with a proper `aria-label` so screen
  readers still hear the destination.
- **UserBar Edit / Sign out**: text on `>=sm`, single inline-svg icon
  on `<sm` (pencil for edit, doorway-arrow for sign out). Both stay
  same hit area, just label-trimmed.
- **Stat strip "View →"**: `hidden sm:block` so the affordance only
  appears on desktop. Mobile cards are fully tappable, so the
  affordance is implicit.

### Self-score: **9.0 / 10**

| Dimension              | Score | Notes                                                            |
|------------------------|------:|------------------------------------------------------------------|
| Defect closure         | 10    | All three observed mobile regressions resolved                  |
| Desktop non-regression | 9     | All changes wrapped in `sm:` breakpoint — pixel-identical >640px |
| Restraint              | 9     | Icons are simple line SVGs matching the design system           |
| Accessibility          | 9     | `aria-label` on collapsed CTAs and icon-only buttons             |
| Touch target           | 8     | Icons are 16px visual; full `<button>` is still 44px hit area    |

**Deductions**:
- −0.5: not tested below 360px (e.g. 320px iPhone SE first-gen).
  Probably still fine but unverified.
- −0.3: sidebar drawer mobile state (when hamburger is tapped) not
  re-screenshotted post round-4 brand changes.
- −0.2: existing chip filter rows on Tasks/Messages still wrap at
  narrow widths. Not the most painful, deferred.

### Round 12 plan: **Loading skeleton refresh**

The `LoadingSkeleton` component in `app/components/LoadingSkeleton.tsx`
still uses `bg-gray-800` / `bg-gray-800/40` patterns from the
pre-theme-token era. It works (CSS shim catches `bg-gray-800` in
light), but it's the only surface that didn't get a deliberate
restyle. Refresh to use:
- subtle bg + animated pulse using the same `anet-brand-pulse`
  rhythm (1.6s opacity drift) for visual cohesion
- proper card structure matching round 3's stat-strip shape
- both themes, no AI-noise

Estimated work: 20 min. Fires next `*/5`.

---

## Round 14 — Cmd+K command palette (scaffold)

### What changed
- New `app/components/CommandPalette.tsx` mounted in `AppShell` so it's
  globally available on every non-login page.
- **Keyboard shortcuts** (global, not per-page):
  - `⌘K` / `Ctrl+K` toggles open/closed
  - `/` opens when no input is focused (Linear-style)
  - `↑↓` navigates results, `Enter` activates, `Esc` closes
- **Layout**: centered modal at 10vh-15vh from top, max-w-xl, backdrop
  blur over content. Search input + grouped results + footer hint bar.
- **Initial command set**: 10 navigation entries covering every
  primary page (Overview / Tasks / Failed tasks / Nodes / Messages /
  Networks / Audit Log / Server Logs / Admin / Settings). Each carries
  a hint subtitle and a thin-stroke icon.
- **Filter behavior**: case-insensitive search over title + hint + id.
  Active row gets emerald tint + `↵` glyph; mouse hover updates the
  selected index so keyboard and pointer stay in sync.
- **Light/mint surface**: white modal with real soft shadow (vs the
  default `bg-[#0d0d1a]` navy that CSS shim would translate). Override
  ruled in globals.css.

### Self-score: **8.7 / 10**

| Dimension              | Score | Notes                                                                  |
|------------------------|------:|------------------------------------------------------------------------|
| Adoption signal        | 9     | Stripe/Linear/Vercel staple — sets reader expectation that we're modern |
| Keyboard-first         | 9     | All keys wired; mouse + keyboard stay in sync                          |
| Restraint              | 9     | Mono-stroke icons, single accent color, no AI shimmer                   |
| Theme parity           | 9     | Light gets a proper white surface w/ shadow; cyber uses navy           |
| Discoverability        | 7     | No visible "press ⌘K" hint anywhere on the page yet                    |
| Mobile                 | 6     | Works on mobile (tap to open via UI) — but no on-screen launcher yet  |

**Deductions**:
- −0.7: zero on-page hint that the palette exists. Most users will
  never find `⌘K` without docs. Should add a tiny "⌘K" badge in
  sidebar footer or in the UserBar.
- −0.4: no mobile launcher. Mobile has no obvious affordance.
- −0.2: command set is navigation-only. Round 15 will add actions
  (theme toggle / sign out / Dispatch open) and recent-commands.

### Round 15 plan: **Cmd+K actions + recent-commands**

Extend the scaffold with the "Actions" group:
- Toggle theme (cyber ↔ light)
- Open Dispatch dialog (current page's Dispatch button)
- Sign out
- Copy current URL

Plus add a `Recents` group at the top that surfaces the last 3-5
commands the user invoked (ring buffer in `sessionStorage`).

Plus a discoverability nudge — tiny `⌘K` chip in sidebar footer +
UserBar tooltip.

Estimated work: 25 min. Fires next `*/5`.

---

## Round 12 — Loading skeleton refresh

### What changed
- `LoadingSkeleton` now **mirrors the actual Overview layout** so the
  page doesn't shift on data arrival. Old version was generic header
  + broadcast + topology + 4-card grid; new version shows: 4 KPI
  cards, Dispatch+UserBar row, Config bar, 3-card stat strip, 3-tile
  nav rail, Broadcast bar, 4-card agent grid.
- Switched from Tailwind's `animate-pulse` (1s opacity drift) to a
  custom `anet-skeleton-pulse` (1.6s) to match the same rhythm as
  `anet-brand-pulse` in the sidebar and the health banner amber dot.
  Visual cohesion across the design system.
- Introduced `anet-skeleton-bar` class with explicit per-theme
  background: `#1a1a2a` on dark (lighter navy on dark card),
  `#d4d8df` on light/mint (mid-grey on white card). The previous
  attempt to reuse the `bg-[#1a1a2a]` shim was too subtle (light
  card #ffffff vs bar mapped to bg-elevated #eef0f4 = only ~7
  brightness levels different = invisible bars).
- All bar dimensions use rem-based explicit values via inline style
  so they don't depend on Tailwind purge correctness.
- `prefers-reduced-motion: reduce` kills the pulse on both classes.

### Self-score: **9.0 / 10**

| Dimension              | Score | Notes                                                            |
|------------------------|------:|------------------------------------------------------------------|
| No content shift       | 9     | Skeleton matches Overview structure cell-for-cell                |
| Theme parity           | 10    | Both themes get visible bars (the original sin of round 11 plan) |
| Restraint              | 9     | No shimmer-gradient, no animation noise, just 1.6s opacity drift |
| Design-system cohesion | 9     | Same pulse rhythm as brand pulse + health banner amber           |
| Accessibility          | 9     | prefers-reduced-motion respected on both classes                 |

**Deductions**:
- −0.5: skeleton shows the FULL Overview (8+ blocks). Most actual
  page-loads complete in <300ms so user barely sees this. Slower
  hubs may see the whole thing; some users might prefer a shorter
  skeleton. Could trim agent grid to 2 cards if it feels long in
  practice.
- −0.5: the agent-card skeleton is generic (status dot + alias bar
  + 3 detail bars). Real cards carry status chip + agent type +
  server hostname + uptime — could mirror more specifically.

### Round 13 plan: **Tasks status tabs — color coding**

The Tasks page filter tab strip (`All / created / delivered / acked /
running / replied / closed / failed / cancelled / expired`) is all
neutral-styled — no visual scannability. Color-code each by its
status family using the same tokens as the chips system used
elsewhere (running=green, replied=purple, failed=red, etc.), so the
user can spot "failed" without reading every label.

Estimated work: 20 min. Fires next `*/5`.
