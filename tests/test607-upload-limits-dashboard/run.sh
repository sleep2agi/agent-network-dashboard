#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_DIR=${ARTIFACT_DIR:-/artifacts}
REPORT="$ARTIFACT_DIR/report-test607-upload-limits-dashboard.txt"
mkdir -p "$ARTIFACT_DIR"
: > "$REPORT"
exec > >(tee -a "$REPORT") 2>&1

echo "# test607 dashboard — authoritative Hub upload limits"
echo "source_commit=${TEST607_DASHBOARD_SOURCE_COMMIT:-unknown}"
echo "date=$(date -Is)"

run_unit() { bun test app/lib/hub-upload-limits.test.mjs; }
run_contract() { node tests/upload-limits-module.test.mjs; }

echo "L0 resolver behavior + production wiring contract"
run_unit
run_contract

echo "L1 TypeScript + production Next build"
bunx tsc --noEmit
node node_modules/next/dist/bin/next build
test -s .next/BUILD_ID

cp app/api/hub/health/route.ts /tmp/test607-health-route.ts
cp app/lib/hub-upload-limits.ts /tmp/test607-limits.ts

echo "L2 witnessed-red: boot health must warm the shared cache"
sed -i 's/    recordHubUploadLimits(data);/    void data;/' app/api/hub/health/route.ts
grep -Fq 'void data;' app/api/hub/health/route.ts
set +e
run_contract >/tmp/test607-warm-red.log 2>&1
warm_rc=$?
set -e
if [ "$warm_rc" -eq 0 ]; then
  echo "MUTATION_FALSE_GREEN: boot-health-cache-warm"
  exit 1
fi
echo "MUTATION_RED: boot-health-cache-warm rc=$warm_rc"
cp /tmp/test607-health-route.ts app/api/hub/health/route.ts

echo "L3 witnessed-red: fallback must never become silent"
sed -i 's/        logger.error(/        void logger.error; (/g' app/lib/hub-upload-limits.ts
grep -Fq 'void logger.error; (' app/lib/hub-upload-limits.ts
set +e
run_unit >/tmp/test607-log-red.log 2>&1
log_rc=$?
set -e
if [ "$log_rc" -eq 0 ]; then
  echo "MUTATION_FALSE_GREEN: fallback-loud-log"
  exit 1
fi
echo "MUTATION_RED: fallback-loud-log rc=$log_rc"
cp /tmp/test607-limits.ts app/lib/hub-upload-limits.ts

echo "L4 restored green"
run_unit
run_contract
echo "RESULT: PASS"
