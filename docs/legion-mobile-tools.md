# Legion 3D mobile controls draft

Independent follow-up to #78, based on exact
`5a5fe000079966a8ddafc8f561d5dfd4e59e96ff`. It is not a prerequisite for the
already-reviewed #78/#79 integration or a release-version change.

## Interaction

- Mobile keeps rotation status, reset and node list directly available. The 2D
  view switch stays visible beside the title, with its own 44px touch target.
- Fullscreen, clean view, PNG export and the platform view share a disclosure.
  It uses normal buttons/links, `aria-expanded` and `aria-controls`, not a menu
  role with different keyboard semantics. Desktop keeps the controls exposed.
- Escape closes the disclosure, returns focus to its trigger and preserves the
  selected node/search. Collapsed controls leave the tab sequence. Opening the
  list closes the disclosure; an outside pointer press also closes it.
- Enter activates the focused toolbar control even when a node is selected.
- Clean view supports a single tap/click on the canvas to restore controls. That
  action does not select the node beneath it. Dragging still rotates the scene;
  Escape recovery remains available. The mobile disclosure explains recovery.
- The disclosure is inside the measured header. Its real dimensions participate
  in existing label/control avoidance and initial/explicit-reset framing.
  Opening and closing controls must preserve a manually rotated camera.

## Verification

The original 390px fixture header measured 182px high (local y=12..194). The
follow-up probe checks a compact default header of at most 160px, visible 2D and
primary actions, 44px touch targets, and no overflow down to 320px.

Run from a clean, committed checkout with an exact matching local build:

```sh
npm test
npm run gates
npm run oss:check
npm run lint
npm run build -- --webpack
COMMHUB_URL=http://127.0.0.1:1 DASHBOARD_PASSWORD=disc-fixture-only \
  npm start -- --hostname 127.0.0.1 --port 3137
BASE_URL=http://127.0.0.1:3137 OUTPUT_DIR=/absolute/path/to/evidence \
  node scripts/smoke-legion-discs.mjs
```

The probe extends the disc suite with disclosure keyboard/focus checks, real
touch recovery, successful and denied fullscreen, PNG downloads, both non-origin
department and portrait camera observations across 130 RAFs, and responsive
collapse. Expanded dense and empty-department scenes also run the geometry and
label checks. Baseline 1440/390 dark/light, sparse/deep/dense/empty, edge picking,
labels, leaders and button/R-reset coverage remain in the same probe.

All browser data and portraits are synthetic. The evidence includes source SHA,
dirty status, build SHA and exact probe hash; failed checks exit nonzero. Screenshots
are local fixture evidence, not real-Hub or deployed acceptance.
