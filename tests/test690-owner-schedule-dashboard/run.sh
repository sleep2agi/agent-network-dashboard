#!/bin/sh
set -eu
test "${TEST690_SOURCE_COMMIT:-unknown}" != unknown
node tests/test690-owner-schedule-dashboard/contract.test.mjs
node tests/test690-owner-schedule-dashboard/fake-hub.mjs >/tmp/test690-hub.log 2>&1 &
hub_pid=$!

ANET_DASHBOARD_PASSWORD=admin123 COMMHUB_URL=http://127.0.0.1:9999 npm run dev >/tmp/test690-dashboard.log 2>&1 &
dashboard_pid=$!
trap 'kill "$dashboard_pid" "$hub_pid" 2>/dev/null || true; test -f /tmp/test690-page.orig && cp /tmp/test690-page.orig app/node/page.tsx || true; test -f /tmp/test690-route.orig && cp /tmp/test690-route.orig app/api/hub/nodes/[ref]/external-schedule-edits/route.ts || true' EXIT INT TERM
for _ in $(seq 1 80); do
  node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && break
  sleep 1
done
node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
TEST_URL=http://localhost:3000 npx playwright test tests/test690-owner-schedule-dashboard/owner-schedule-edit.spec.ts --workers=1 --reporter=line

cp app/node/page.tsx /tmp/test690-page.orig
sed -i 's/schedule.editable === true && Number.isSafeInteger(schedule.revision)/true/' app/node/page.tsx
cmp -s app/node/page.tsx /tmp/test690-page.orig && { echo 'editable mutation byte-identical' >&2; exit 1; }
set +e
TEST_URL=http://localhost:3000 npx playwright test tests/test690-owner-schedule-dashboard/owner-schedule-edit.spec.ts --workers=1 --reporter=line >/tmp/test690-editable-red.log 2>&1
editable_rc=$?
set -e
cp /tmp/test690-page.orig app/node/page.tsx
test "$editable_rc" -ne 0
test -s /tmp/test690-editable-red.log
echo "mutation=remove-editable-gate rc=$editable_rc witnessed-red"

cp app/api/hub/nodes/[ref]/external-schedule-edits/route.ts /tmp/test690-route.orig
sed -i "s/new Set(\['cron', 'enabled'\])/new Set(['cron', 'enabled', 'command'])/" app/api/hub/nodes/[ref]/external-schedule-edits/route.ts
cmp -s app/api/hub/nodes/[ref]/external-schedule-edits/route.ts /tmp/test690-route.orig && { echo 'nested-key mutation byte-identical' >&2; exit 1; }
set +e
TEST_URL=http://localhost:3000 npx playwright test tests/test690-owner-schedule-dashboard/owner-schedule-edit.spec.ts --workers=1 --reporter=line >/tmp/test690-patch-red.log 2>&1
patch_rc=$?
set -e
cp /tmp/test690-route.orig app/api/hub/nodes/[ref]/external-schedule-edits/route.ts
test "$patch_rc" -ne 0
test -s /tmp/test690-patch-red.log
echo "mutation=allow-command-patch-key rc=$patch_rc witnessed-red"

npm run lint
npm run build
echo "source_commit=$TEST690_SOURCE_COMMIT"
echo "RESULT: PASS"
