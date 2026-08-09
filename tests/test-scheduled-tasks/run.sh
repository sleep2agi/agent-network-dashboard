#!/bin/sh
set -eu
echo "# Dashboard scheduled tasks source=${DASHBOARD_SCHEDULER_SOURCE_COMMIT:-unknown}"
node tests/scheduled-tasks-module.test.mjs
npx tsc --noEmit
npm run build
echo "RESULT: PASS"
