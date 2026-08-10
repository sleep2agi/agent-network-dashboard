#!/bin/sh
set -eu

dashboard_pid=''
start_dashboard() {
  ANET_DASHBOARD_PASSWORD=admin123 COMMHUB_URL=http://127.0.0.1:9999 npm run dev >/tmp/dashboard.log 2>&1 &
  dashboard_pid=$!

  ready=0
  for _ in $(seq 1 60); do
    if node -e "fetch('http://localhost:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
      ready=1
      break
    fi
    sleep 1
  done

  if [ "$ready" -ne 1 ]; then
    echo 'dashboard did not become ready' >&2
    tail -100 /tmp/dashboard.log >&2
    exit 1
  fi
}

stop_dashboard() {
  if [ -n "$dashboard_pid" ]; then
    kill "$dashboard_pid" 2>/dev/null || true
    wait "$dashboard_pid" 2>/dev/null || true
    dashboard_pid=''
  fi
}

restore_source() {
  if [ -f /tmp/NodeList.tsx.original ]; then
    cp /tmp/NodeList.tsx.original app/components/NodeList.tsx
  fi
}

trap 'stop_dashboard; restore_source' EXIT INT TERM

npm run lint -- app/components/NodeList.tsx tests/e2e-162-node-list-virtualization.spec.ts

start_dashboard

echo "source_commit=$TEST162_SOURCE_COMMIT"
TEST_URL=http://localhost:3000 ANET_DASHBOARD_PASSWORD=admin123 npx playwright test \
  tests/e2e-162-node-list-virtualization.spec.ts tests/e2e-stage-a-node-list.spec.ts \
  --workers=1 --reporter=line

# Load-bearing mutation: deleting the slice must remount all 180 rows and
# make the bounded-DOM behavior test fail. Byte-change and failure-reason
# checks prevent a no-op sed from being counted as witnessed red.
stop_dashboard
cp app/components/NodeList.tsx /tmp/NodeList.tsx.original
sed 's/const visibleSessions = sessions.slice(virtualWindow.start, virtualWindow.end);/const visibleSessions = sessions;/' \
  app/components/NodeList.tsx > /tmp/NodeList.tsx.mutated
cmp -s app/components/NodeList.tsx /tmp/NodeList.tsx.mutated && {
  echo 'mutation did not change NodeList.tsx' >&2
  exit 1
}
cp /tmp/NodeList.tsx.mutated app/components/NodeList.tsx
start_dashboard
set +e
TEST_URL=http://localhost:3000 ANET_DASHBOARD_PASSWORD=admin123 npx playwright test \
  tests/e2e-162-node-list-virtualization.spec.ts \
  --workers=1 --reporter=line >/tmp/test162-mutation.log 2>&1
mutation_rc=$?
set -e
if [ "$mutation_rc" -eq 0 ] || ! grep -q 'toBeLessThan' /tmp/test162-mutation.log; then
  echo 'deleting the virtual slice did not produce the expected behavior failure' >&2
  cat /tmp/test162-mutation.log >&2
  exit 1
fi
echo "mutation delete-window-slice: witnessed red (rc=$mutation_rc)"
echo 'RESULT: PASS'
