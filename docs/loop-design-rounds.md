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
