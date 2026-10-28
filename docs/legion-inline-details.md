# Legion in-place chat and platform details

Independent follow-up draft based on #80 at `a33c58466563106a6ecc82ddfd911be929732863`.

- 3D Agent actions (detail button, Enter, double-click, repeated list selection)
  open the existing chat transport inside the scene. Closing keeps selection,
  search and camera. Scene shortcuts cannot consume chat keystrokes. Conversation
  history, events, sends and drafts stay scoped to the current network.
- Platform views use the complete directory, including first-page unowned Agents.
  `agent_department_supported=true`: missing/null Agent department means unassigned.
  Only old-Hub capability absence uses owner placement, with an explicit notice.
  Alias duplicates retain the newest record and exact node ID. People stay on the
  separate human department axis. Empty and unknown departments remain visible.
- Bright edges follow actual department parents, with top-level departments
  connected to the current network. No relationship is inferred from a name.
- Select a platform to inspect its full, searchable and paginated Agent roster.
  Metadata uses exact node IDs and scoped snapshots, not a request per Agent.
  Connection, task state, lifecycle, model, runtime, host, working directory,
  session and manageability are separate fields. Missing values say unreported.
- Fullscreen uses the actual browser API; denial produces an error, not a success
  state. Desktop controls reserve space for the collapsed global server dock and
  keep a 44px minimum target in both dimensions. Acceptance samples the complete
  button area and clicks its initial right-bottom edge at 1440/1024/390/320px;
  a center-only click after scrolling could miss the overlap. Chat stays inside
  the fullscreen subtree and supports small screens.

## Acceptance

`app/lib/legion-directory.test.mjs` covers modern/legacy placement, explicit null,
unowned Agents, deduplication, unknown/cyclic departments, and pagination failures.

`scripts/smoke-legion-interactions.mjs` only accepts a dedicated loopback preview
(not 3101/3102). It reads health identity before launching Chromium, refuses dirty
tracked source or a source/build mismatch, intercepts all APIs and portraits with
synthetic data, and aborts external requests. Synthetic send endpoints are fulfilled
in-browser and never reach a Hub. Screenshots and the hashed probe/result go to
`OUTPUT_DIR`. Failing assertions or browser errors cause nonzero exit.

```sh
BASE_URL=http://127.0.0.1:3141 OUTPUT_DIR=/tmp/opencode/legion-details-evidence \
  node scripts/smoke-legion-interactions.mjs
```

Use `COMMHUB_URL=http://127.0.0.1:1` and a fixture-only Dashboard password on the
preview; pass the same password as `FIXTURE_PASSWORD` to the probe. Existing disc,
label, camera and mobile controls acceptance remains in `smoke-legion-discs.mjs`.
