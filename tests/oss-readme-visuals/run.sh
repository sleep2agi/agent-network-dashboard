#!/bin/sh
set -eu

ANET_DASHBOARD_PASSWORD=admin123 COMMHUB_URL=http://127.0.0.1:9999 npm run dev >/tmp/dashboard.log 2>&1 &
dashboard_pid=$!
trap 'kill "$dashboard_pid" 2>/dev/null || true' EXIT INT TERM

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

if [ -n "${OSS_SCREENSHOT_GREP:-}" ]; then
  OSS_SCREENSHOT_DIR=/output ANET_DASHBOARD_PASSWORD=admin123 \
    npx playwright test tests/oss-readme-visuals.spec.ts --workers=1 --reporter=line --grep "$OSS_SCREENSHOT_GREP"
else
  OSS_SCREENSHOT_DIR=/output ANET_DASHBOARD_PASSWORD=admin123 \
    npx playwright test tests/oss-readme-visuals.spec.ts --workers=1 --reporter=line
fi

if [ -z "${OSS_SCREENSHOT_GREP:-}" ] || echo "$OSS_SCREENSHOT_GREP" | grep -q 'conversation'; then
  test -s /output/dashboard-chat.png
fi
if [ -z "${OSS_SCREENSHOT_GREP:-}" ] || echo "$OSS_SCREENSHOT_GREP" | grep -q 'topology'; then
  test -s /output/dashboard-topology.png
fi
if [ -n "${HOST_UID:-}" ] && [ -n "${HOST_GID:-}" ]; then
  chown "$HOST_UID:$HOST_GID" /output/dashboard-chat.png /output/dashboard-topology.png 2>/dev/null || true
fi
echo 'RESULT: PASS — generated synthetic chat and topology README screenshots'
