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
  app/api/hub/send/route.ts \
  app/components/TaskChatPanel.tsx \
  app/lib/chat-outbox.ts \
  app/lib/chat-drafts.ts \
  app/lib/hub-send-recovery.ts \
  app/lib/task-history-pagination.ts \
  tests/test-chat-ha/*.test.mts
npm run build
