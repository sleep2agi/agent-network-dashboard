#!/bin/sh
set -eu

test "${TEST185_DASH_SOURCE_COMMIT:-unknown}" != unknown
mkdir -p /artifacts

ANET_DASHBOARD_PASSWORD=admin123 COMMHUB_URL=http://127.0.0.1:9999 npm run dev >/tmp/test185-dashboard.log 2>&1 &
dashboard_pid=$!
trap 'kill "$dashboard_pid" 2>/dev/null || true; test -f /tmp/test185-page.orig && cp /tmp/test185-page.orig app/node/page.tsx || true' EXIT INT TERM

for _ in $(seq 1 80); do
  node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && break
  sleep 1
done
node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

TEST_URL=http://localhost:3000 TEST185_SCREENSHOT_DIR=/artifacts \
  npx playwright test tests/test185-external-schedules-ui/external-schedules.spec.ts --workers=1 --reporter=line
test -s /artifacts/external-schedules.png

cp app/node/page.tsx /tmp/test185-page.orig
node tests/test185-external-schedules-ui/mutate-card.mjs app/node/page.tsx
cmp -s app/node/page.tsx /tmp/test185-page.orig && { echo 'card mutation was byte-identical' >&2; exit 1; }
set +e
TEST_URL=http://localhost:3000 TEST185_SCREENSHOT_DIR=/artifacts TEST185_BEFORE_SCREENSHOT=1 \
  npx playwright test tests/test185-external-schedules-ui/external-schedules.spec.ts --workers=1 --reporter=line >/tmp/test185-mutation.log 2>&1
mutation_rc=$?
set -e
cp /tmp/test185-page.orig app/node/page.tsx
test "$mutation_rc" -ne 0
test -s /artifacts/external-schedules-before.png
grep -q 'external-schedules-card' /tmp/test185-mutation.log
printf 'mutation=delete-card-wiring rc=%s witnessed-red\n' "$mutation_rc"

npm run lint
npm run build
printf 'source_commit=%s\n' "$TEST185_DASH_SOURCE_COMMIT"
printf 'RESULT: PASS\n'
