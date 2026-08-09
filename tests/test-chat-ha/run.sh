#!/bin/sh
set -eu

echo "# dashboard test459 — task history keyset pagination"
echo "source_commit=${TEST459_SOURCE_COMMIT:-unknown}"

node --experimental-strip-types --test tests/test-chat-ha/*.test.mts

HELPER=app/lib/task-history-pagination.ts
cp "$HELPER" /tmp/test459-helper.ts

echo "witnessed-red: task-id cursor is load-bearing"
sed -i "/query.set('before_task_id'/d" "$HELPER"
set +e
node --experimental-strip-types --test tests/test-chat-ha/task-history-pagination.test.mts \
  >/tmp/test459-cursor-red.log 2>&1
cursor_rc=$?
set -e
if [ "$cursor_rc" -eq 0 ]; then
  echo "MUTATION_FALSE_GREEN: before-task-id"
  exit 1
fi
grep -Fq 'older history request sends the exact timestamp and task-id cursor' /tmp/test459-cursor-red.log
echo "MUTATION_RED: before-task-id rc=$cursor_rc"
cp /tmp/test459-helper.ts "$HELPER"

echo "witnessed-red: existing live rows must survive an incremental page"
sed -i 's/\[\.\.\.newestFirstPage, \.\.\.retained\]/[...newestFirstPage]/' "$HELPER"
set +e
node --experimental-strip-types --test tests/test-chat-ha/task-history-pagination.test.mts \
  >/tmp/test459-merge-red.log 2>&1
merge_rc=$?
set -e
if [ "$merge_rc" -eq 0 ]; then
  echo "MUTATION_FALSE_GREEN: incremental-merge"
  exit 1
fi
grep -Fq 'incremental pages stay ordered without dropping live or same-second rows' /tmp/test459-merge-red.log
echo "MUTATION_RED: incremental-merge rc=$merge_rc"
cp /tmp/test459-helper.ts "$HELPER"

echo "restored green"
node --experimental-strip-types --test tests/test-chat-ha/task-history-pagination.test.mts

npx eslint \
  app/api/hub/tasks/route.ts \
  app/api/hub/send/route.ts \
  app/components/TaskChatPanel.tsx \
  app/lib/chat-outbox.ts \
  app/lib/chat-drafts.ts \
  app/lib/hub-send-recovery.ts \
  app/lib/task-history-pagination.ts \
  tests/test-chat-ha/*.test.mts
npm run build

capture_proxy_requests() {
  label=$1
  fake_port=$2
  next_port=$3
  capture="/tmp/test459-upstream-$label.txt"
  : >"$capture"
  TEST459_CAPTURE_FILE="$capture" TEST459_FAKE_HUB_PORT="$fake_port" \
    node tests/test-chat-ha/task-proxy-capture.mjs >"/tmp/test459-fake-hub-$label.log" 2>&1 &
  fake_hub_pid=$!
  COMMHUB_URL="http://127.0.0.1:$fake_port" npm start -- -p "$next_port" \
    >"/tmp/test459-next-$label.log" 2>&1 &
  next_pid=$!
  cleanup_proxy_test() {
    kill "$next_pid" "$fake_hub_pid" 2>/dev/null || true
  }
  trap cleanup_proxy_test EXIT
  ready=0
  for _ in $(seq 1 100); do
    if curl -fsS "http://127.0.0.1:$next_port/login" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 0.1
  done
  test "$ready" -eq 1
  proxy_response=$(curl -fsS \
    -H 'Cookie: anet_dashboard_session=v3:atok_test459_proxy_token' \
    "http://127.0.0.1:$next_port/api/hub/tasks?network_id=net-a&to_name=agent%20%2F%20one&limit=12&before=2026-08-09T11%3A22%3A33.000Z&before_task_id=tie-y")
  printf '%s' "$proxy_response" | grep -Fq 'older-same-second-a'
  test "$(grep -c '^GET /api/tasks?' "$capture")" -eq 2
  cleanup_proxy_test
  trap - EXIT
  printf '%s\n' "$capture"
}

assert_compound_cursor_forwarded() {
  capture=$1
  grep -Eq '^GET /api/tasks\?.*network_id=net-a.*before=2026-08-09T11%3A22%3A33.000Z.*before_task_id=tie-y' "$capture"
  awk '/^GET \/api\/tasks\?/ && $0 !~ /network_id=/ && $0 ~ /before=2026-08-09T11%3A22%3A33.000Z/ && $0 ~ /before_task_id=tie-y/ { found=1 } END { exit found ? 0 : 1 }' "$capture"
}

echo "real Next proxy forwards the compound cursor on primary and network-empty retry"
GREEN_CAPTURE=$(capture_proxy_requests green 9459 3459)
assert_compound_cursor_forwarded "$GREEN_CAPTURE"

echo "witnessed-red: proxy forwarding is load-bearing"
ROUTE=app/api/hub/tasks/route.ts
cp "$ROUTE" /tmp/test459-route.ts
sed -i "/if (beforeTaskId) .*before_task_id/d" "$ROUTE"
test "$(grep -c "before_task_id" "$ROUTE")" -eq 1
npm run build >/tmp/test459-proxy-mutant-build.log
MUTANT_CAPTURE=$(capture_proxy_requests mutant 9460 3460)
if assert_compound_cursor_forwarded "$MUTANT_CAPTURE"; then
  echo "MUTATION_FALSE_GREEN: proxy-before-task-id"
  exit 1
fi
echo "MUTATION_RED: proxy-before-task-id rc=1"

echo "restore proxy and production build"
cp /tmp/test459-route.ts "$ROUTE"
npm run build >/tmp/test459-proxy-restored-build.log
RESTORED_CAPTURE=$(capture_proxy_requests restored 9461 3461)
assert_compound_cursor_forwarded "$RESTORED_CAPTURE"
