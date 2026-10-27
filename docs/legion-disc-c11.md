# Legion 3D department-disc draft

Scope: #61 remaining four 10px controls and #64 department geometry on exact
`c11c9feb78f9ed5adbe726b63e520c040856fc37` (#76,
`design/legion-safe-framing`). This is a stacked **draft**, with no release-version
bump. The parent dependency chain and final brand/merge decisions require owner review.

## Geometry and interaction

- Department radius still derives from `deptWorldRadius(depth)` and the current
  projection. `departmentDisc()` gives `rx = max(16, 2.1 * radius)`, `ry = .42 * rx`.
- The page shares those axes between drawing, hover/selected outlines, the three
  pointer hit tests and framing. Picking keeps the existing 16/18px minimum
  tolerance and reverse-depth priority without treating a disc as a wide circle.
- Labels, body avoidance and leaders share the **same anchor object** (axes plus
  a 2px stroke allowance), including departments with no full label. Existing
  filtering, .35 dimmed labels, selected/hover priority, deep-department priority,
  name wrapping and no-space omission remain in the common label path.
- Automatic fitting reprojects at candidate zooms, preserving the 16px floor,
  fixed-pixel outline clearance and full orbits. Rendering and picking receive
  the final fitted projection in the same frame. Manual rotation still suppresses
  automatic recovery until reset.
- Short names use the foreground token on the translucent disc in both themes.

## Verification

The browser probe uses **synthetic data**, intercepted API responses and fixture
portraits. It does not demonstrate real Hub acceptance. It measures canvas `arc`
and `ellipse` operations, rather than assuming every body is circular.

```sh
npm test
npm run gates
npm run lint
npm run build -- --webpack
```

Start a dedicated local preview with the test-only password and an unreachable Hub
(the browser intercepts every API request):

```sh
COMMHUB_URL=http://127.0.0.1:1 DASHBOARD_PASSWORD=disc-fixture-only \
  npm start -- --hostname 127.0.0.1 --port 3127
BASE_URL=http://127.0.0.1:3127 OUTPUT_DIR=/absolute/path/to/evidence \
  node scripts/smoke-legion-discs.mjs
```

Use the matching installed Playwright browser and a CJK font when necessary.
The probe refuses non-loopback targets and the shared real-preview ports 3101/3102.
All browser API calls are fixtures; external-origin requests are blocked.

Coverage:

- 1440×900 / 390×844, dark/light themes, sparse/empty/deep/dense departments.
- Painted fixture portraits, short names, full wrapped names, label/body and
  toolbar/footer clearance, leaders attached to the ellipse edge.
- Wide-edge hover, selection and double click; blank space above the ellipse;
  selected contour axes and all four updated text sizes.
- Non-origin department movement after dragging, stability across **130 RAFs**,
  both button and R reset, clean-view restoration.
- Geometry unit regressions cover both-axis picking, nearest-depth priority,
  tolerance, final-zoom minima/strokes, full-orbit fitting and impossible bounds.

Each run saves screenshots, `result.json` and an exact probe copy. Metadata includes
source SHA, tracked-file dirty state, build-reported SHA and probe hash. Any false
check or browser/probe error exits nonzero. Use a committed, freshly built preview
for final evidence; a dirty tree's build stamp alone is not an exact source identity.
