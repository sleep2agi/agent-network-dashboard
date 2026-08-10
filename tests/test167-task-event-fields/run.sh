#!/bin/sh
set -eu

test "${TEST167_SOURCE_COMMIT:-unknown}" != unknown
mkdir -p /artifacts

ANET_DASHBOARD_PASSWORD=admin123 COMMHUB_URL=http://127.0.0.1:9999 npm run dev >/tmp/test167-dashboard.log 2>&1 &
dashboard_pid=$!
trap 'kill "$dashboard_pid" 2>/dev/null || true' EXIT INT TERM

ready=0
for _ in $(seq 1 60); do
  if node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  tail -100 /tmp/test167-dashboard.log >&2
  exit 1
fi

TEST_URL=http://localhost:3000 \
TASK_EVENT_SCREENSHOT_DIR=/artifacts \
npx playwright test tests/test167-task-event-fields/task-event-fields.spec.ts \
  --workers=1 --reporter=line

test -s /artifacts/task-event-fields.png
echo "source_commit=$TEST167_SOURCE_COMMIT"
echo "RESULT: PASS — legacy and current task events render explicit audit fields"
