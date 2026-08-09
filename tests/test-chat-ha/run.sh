#!/bin/sh
set -eu

node --experimental-strip-types --test tests/test-chat-ha/*.test.mts
npx eslint \
  app/api/hub/send/route.ts \
  app/components/TaskChatPanel.tsx \
  app/lib/chat-outbox.ts \
  app/lib/chat-drafts.ts \
  app/lib/hub-send-recovery.ts \
  app/lib/task-history-pagination.ts \
  tests/test-chat-ha/*.test.mts
npm run build
