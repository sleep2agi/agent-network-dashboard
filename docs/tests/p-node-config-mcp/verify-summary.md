# Node Config MCP Wiring Verification

This PR must be accepted on node-side facts, not on a dashboard-only HTTP 200.

## Acceptance Criteria

1. Dashboard field change reaches the target node

   Change one editable field in the Dashboard node settings panel, save it, and then confirm the target node has actually applied the new config. Acceptable proof is either a node-side config read showing the changed field or RFC-024 persisted ack evidence for the matching config update.

2. Red before green

   Before a successful save test, submit a save for a nonexistent `node_id`. The UI must show the backend error and the route must return a non-2xx/`ok:false` response. The error must not be swallowed, converted to `mock: true`, or rendered as applied.

3. Apply/ack is complete

   A save is not successful just because `update_node_config` accepted it. The flow must call `get_config_update` until the update is `applied`, then call `ack_config_update`. Missing `apply_id`/`update_id`, `rejected`, timeout, missing tool, or ack failure must surface as an error or unconfirmed state.

## Test Scope

Run the green-path validation only on machines with an active host supervisor daemon: `daemon-relay`, `daemon-macmini`, or `daemon-vanisn`. Nodes on machines without a daemon can legitimately fail for lack of a node-side apply target; that belongs to #1334, not this PR.

## Fallback When Backend Is Not Ready

If the hub tools are unavailable or cannot confirm apply, the Dashboard must not report success. The user-facing error should direct operators to modify the target machine with `anet node ...` until the MCP config path is available.
