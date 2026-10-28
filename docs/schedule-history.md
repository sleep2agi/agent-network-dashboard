# Scheduled-task history reads

The expanded schedule owns its history request and feedback. Closing the row,
opening another row, or changing networks disposes that request. A network-keyed
page generation also clears the previous list, expanded row and edit form before
new-network data paints, even if both networks use the same schedule ID.

History reads always include the selected network and `limit=50`. A successful
response with a valid empty `runs` array is the only empty-history state. Pending
reads show loading. HTTP errors, malformed success bodies and connection failures
show a local error with retry. Retry/refresh retains keyboard focus; the history
and retry controls provide at least 44px touch targets.

The existing schedule create/edit/run/cancel API contract remains in use. This
change is client read-state handling; it does not add a scheduler API or execute
jobs during acceptance.

## Browser acceptance

Build a clean committed worktree and run its production build on an isolated
loopback port, with `COMMHUB_URL=http://127.0.0.1:1` and fixture-only authentication.
Use the same `FIXTURE_PASSWORD` for the probe as the preview's
`DASHBOARD_PASSWORD`. Never use a real Hub or real user credentials.

```sh
BASE_URL=http://127.0.0.1:3145 OUTPUT_DIR=/path/to/evidence \
  FIXTURE_PASSWORD=fixture-only node scripts/smoke-schedule-history.mjs
```

The probe checks matching source/build SHA and clean tracked source. It intercepts
browser APIs, blocks external origins and explicitly releases held responses in
reverse order. It covers late success/error, close/reopen, equal IDs across two
networks, loading/empty, 401/403/HTML/invalid JSON/missing runs/null responses,
connection failure, keyboard retry/focus, touch targets and page overflow. The
matrix is dark/light at 1440/390/320px plus the no-network case. Only GET requests
are accepted; results, exact probe and screenshots are written to `OUTPUT_DIR`.
Every read declares its expected schedule ID and network before it starts. The
probe validates the exact pathname, one matching network parameter and `limit=50`
before releasing synthetic data, including every retry. This prevents a fixture
from disguising a request to the wrong schedule as a correct UI response.

Set `MUTATE_HISTORY_TARGET=1` for the negative control: browser instrumentation
deliberately sends schedule B's history requests to schedule A. The probe must
exit nonzero at `cyber-1440-switch-success:read2:exactSchedule`, before supplying
B's fixture data. This opt-in mutation is recorded in the result and never counts
as a normal acceptance run. Any failed assertion, uncaught browser error or
incomplete matrix exits nonzero.
