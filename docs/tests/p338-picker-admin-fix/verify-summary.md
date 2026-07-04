# #338 GA-blocker — picker admin `network_id` fix verify

Mock hub reproducing the post-#380 admin behaviour exactly:

- `GET /api/host-supervisors` (no `network_id`) → **400 `missing_network_id`**
- `GET /api/host-supervisors?network_id=…` → 200 empty `daemons:[]`
- `GET /api/auth/me` → `{ current_network: { network_id: NET }, networks: [{ network_id: NET }] }`

## Reproduce (once fix is applied)

```bash
# 1. Mock hub — reproduces the 400 shape
node /tmp/mock-hub-338.mjs   # see the script in the PR body

# 2. Dashboard prod build against that mock
COMMHUB_URL=http://127.0.0.1:9299 DASHBOARD_PASSWORD=verify338 PORT=3260 npm start

# 3. Direct curl round-trip
curl -c jar -H 'Content-Type: application/json' -d '{"password":"verify338"}' \
  http://127.0.0.1:3260/api/auth/login
curl -b jar 'http://127.0.0.1:3260/api/anet/host-supervisors'
```

Before the fix: dashboard route proxies straight to `hub /api/host-supervisors`
without `network_id`, hub returns 400, picker shows a hub-error surface, the
Next button is disabled and admin is stuck at step 1.

After the fix: dashboard route sees no `network_id` in the query and calls
`resolveDefaultNetworkId()` (which fetches `/api/auth/me`), then forwards the
resolved id to the hub. Hub returns 200 empty. Picker shows the count=0
onboarding hint (`还没有可用的 host_supervisor 节点`) rather than an error.

## Real mock-hub trace during the round-trip

```
[mock-hub-338] listening on http://127.0.0.1:9299
[mock-hub] GET /api/host-supervisors                       ← pre-fix would 400 here
[mock-hub] GET /api/host-supervisors?network_id=net_338_verify_abcdef   ← post-fix retry
[mock-hub] GET /api/auth/me                                ← resolveDefaultNetworkId()
[mock-hub] GET /api/host-supervisors?network_id=net_338_verify_abcdef
[mock-hub] GET /api/host-supervisors?network_id=net_338_verify_abcdef
```

Dashboard response:

```
{"ok":true,"count":0,"daemons":[],"selected":null}   HTTP=200
```

## Playwright drive of `/nodes` → create-node wizard step 1

- `338-01-nodes.png` — `/nodes` page loaded (admin session cookie seeded).
- `338-02-wizard-step1.png` — clicked `+ 新建节点`; wizard step 1 shows:
  - Step label 「服务器」 highlighted.
  - Onboarding hint: **还没有可用的 host_supervisor 节点**.
  - Install command visible: `anet daemon up my-daemon`.
  - Footer copy: 没选服务器之前无法继续 ...
  - `下一步` button correctly disabled (grayed).
  - No 400 / hub-error / status-code text anywhere in the picker.

The picker is now blocked by "no daemon yet" (a real onboarding branch), not
by a hub 400 — which is exactly the RFC-026 §9.4 3-state UI the picker was
designed for.

## Red-line 3-layer audit

- Broad private-fork keyword regex on diff = 0 hits
- Slug regex on diff + commit msg + PR body = 0 hits
- Real vendor key literal regex on diff + evidence = 0 hits
- No `Co-Authored-By` per project policy
