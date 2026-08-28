# Node Config MCP Wiring Verification

This PR must be accepted on node-side facts, not on a dashboard-only HTTP 200.

## Acceptance Criteria

1. Dashboard field change reaches the target node

   Change one editable field in the Dashboard node settings panel, save it, and then confirm the target node has actually applied the new config. Acceptable proof is either a node-side config read showing the changed field or RFC-024 persisted ack evidence for the matching config update.

2. Red before green

   Before a successful save test, submit a save for a nonexistent `node_id`. The UI must show the backend error and the route must return a non-2xx/`ok:false` response. The error must not be swallowed, converted to `mock: true`, or rendered as applied.

3. Apply/ack is complete

   A save is not successful just because `update_node_config` accepted it. The node-side flow must call `get_config_update`, apply the config, then call `ack_config_update`; Dashboard success requires observing the resulting `config_revision` bump. Timeout, missing tool, revision conflict, or node rejection must not look successful.

## Current Verification

- ✅ L2 route contract: mock hub returned `HTTP 200 text/html` for a missing node config path; Dashboard returned `502 {"ok":false,"node_id":"missing-node","error":"node_config_snapshot_unavailable"}`.
- ✅ L2 write payload: mock hub captured MCP `update_node_config` args with nested `patch`: `{"node_id":"demo-node","network_id":"net_contract","base_revision":3,"patch":{"model":"gpt-5.5","flags":{"permissionMode":"auto"},"channels":["commhub","telegram"]}}`.
- ✅ L2 apply timeline: before snapshot `config_revision=3`; POST accepted as `pending`; poll returned `config_revision=4,status=applied`.
- ❓ L3 node-side file before/after: not run in this repo pass. Do not mark as verified until a disposable node is created, updated, checked at `~/.anet/nodes/<alias>/config.json`, and deleted.

## TypeScript Toolchain Check

`npx tsc --version` and the local compiler both reported real TypeScript:

```text
Version 5.9.3
```

Known-bad temporary file:

```ts
const x: string = 123;
```

Local compiler red check:

```text
../../../tmp/anet-tsc-red.ts(1,7): error TS2322: Type 'number' is not assignable to type 'string'.
```

Project green check:

```text
node ./node_modules/typescript/bin/tsc --noEmit
# exit 0, no output
```

## Lint Evidence

Full lint still fails on existing repo files, but the changed node-config files are not in the lint error list.

```text
lint_exit=1
changed_file_error_hits=0
```

Representative existing lint errors:

```text
/home/vansin/agent-network-dashboard/.anet/node-server.ts
  184:86  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  238:47  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

/home/vansin/agent-network-dashboard/.vercel/output/functions/_global-error.rsc.func/___next_launcher.cjs
  11:26  error  A `require()` style import is forbidden  @typescript-eslint/no-require-imports

/home/vansin/agent-network-dashboard/.vercel/output/functions/_middleware.func/___next_launcher.cjs
  11:26   error  A `require()` style import is forbidden  @typescript-eslint/no-require-imports
  108:32  error  A `require()` style import is forbidden  @typescript-eslint/no-require-imports
```

## Test Scope

Run the green-path validation only on machines with an active host supervisor daemon: `daemon-relay`, `daemon-macmini`, or `daemon-vanisn`. Nodes on machines without a daemon can legitimately fail for lack of a node-side apply target; that belongs to #1334, not this PR.

## Fallback When Backend Is Not Ready

If the hub tools are unavailable or cannot confirm apply, the Dashboard must not report success. The user-facing error should direct operators to modify the target machine with `anet node ...` until the MCP config path is available.
