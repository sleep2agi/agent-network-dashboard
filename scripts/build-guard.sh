#!/usr/bin/env bash
# Build-on-deploy guard (v0.11 P0 — review round 2 root cause).
#
# Symptom: prod :3001 served a build older than the deployed source. Next.js
# embeds content-hashed chunk names in the HTML it renders; when the on-disk
# .next no longer matches HEAD, the browser requests chunk URLs the server
# can't serve -> 404 -> the page hangs on the loading spinner (Vincent tg923,
# "转圈加载时间太长"). The earlier prepublishOnly guard only ensures a build
# exists before npm publish; this closes the *runtime* gap: never serve a
# build whose commit != HEAD.
#
# Compares the build marker (.next/BUILD_COMMIT, written by the postbuild
# `stamp-build-commit.mjs`) against the current HEAD. If they differ it rebuilds
# and restarts the :3001 next-server.
#
# Modes:
#   build-guard.sh --check   read-only freshness probe; exit 0=fresh, 1=stale.
#                            Side-effect free — safe for healthchecks/CI/cron.
#   build-guard.sh           rebuild + restart :3001 if stale.
#
# ⚠️ The default (acting) mode rebuilds and bounces the LIVE :3001 process —
# run it only inside a deploy window you control. The --check mode never
# touches anything.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3001}"
HOST="${HOST:-127.0.0.1}"
HEAD="$(git rev-parse HEAD)"
MARKER="$(cat .next/BUILD_COMMIT 2>/dev/null || echo '<none>')"

if [ "$HEAD" = "$MARKER" ]; then
  echo "build-guard: up to date (build=HEAD=$HEAD) — no action"
  exit 0
fi

echo "build-guard: STALE — running build was made from '$MARKER', HEAD is '$HEAD'"
if [ "${1:-}" = "--check" ]; then
  exit 1   # report only; let the caller decide when to act
fi

echo "build-guard: rebuilding (npm run build)…"
npm run build   # postbuild re-stamps .next/BUILD_COMMIT to HEAD

echo "build-guard: restarting :$PORT…"

# Is anything still listening on $PORT? Don't depend on a single tool — ss may
# be absent on a minimal host. Prefer ss; otherwise probe with curl so a host
# without ss still detects an occupied port. (review round 2, 通信牛 blocker:
# if we can't see the stale listener we must NOT blindly start a second one.)
port_listening() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -q ":$PORT "
  else
    curl -sf -o /dev/null --max-time 2 "http://$HOST:$PORT/login"
  fi
}

OLD="$(ss -tlnp 2>/dev/null | grep ":$PORT " | grep -oP 'pid=\K[0-9]+' || true)"
if [ -n "$OLD" ]; then
  echo "build-guard: stopping old next-server pid(s): $OLD"
  kill $OLD 2>/dev/null || true
  # Wait for the old process to actually release the port before starting the
  # new one — otherwise `next start` exits "port in use" and we'd silently keep
  # serving the stale build.
  for _ in $(seq 1 10); do port_listening || break; sleep 1; done
  if port_listening; then
    echo "build-guard: killed pid(s) $OLD but :$PORT is still listening — aborting (refuse to start a second server)" >&2
    exit 1
  fi
elif port_listening; then
  # Port is occupied but we found no pid to stop (no ss, or ss reported no
  # pid=). This is the critical false-positive case: starting a new server now
  # either fails to bind or leaves the stale one answering, and the curl check
  # below would wrongly report "up on HEAD ✓". Fail loudly instead.
  echo "build-guard: :$PORT is in use but no pid could be found to stop it — aborting to avoid a false 'up on HEAD'. Stop the stale next-server manually, then re-run." >&2
  exit 1
fi

nohup npx next start -p "$PORT" -H "$HOST" > "/tmp/anet-dash-$PORT.log" 2>&1 &
NEW_PID=$!
echo "build-guard: started next start -p $PORT -H $HOST (pid $NEW_PID, log: /tmp/anet-dash-$PORT.log)"

# Verify the NEW process specifically: it must stay alive AND answer /login.
# Checking only curl could pass against a stale server still holding the port —
# so gate on kill -0 of the pid we just spawned first.
for _ in $(seq 1 15); do
  if ! kill -0 "$NEW_PID" 2>/dev/null; then
    echo "build-guard: new next-server (pid $NEW_PID) exited early — check /tmp/anet-dash-$PORT.log" >&2
    exit 1
  fi
  if curl -sf -o /dev/null "http://$HOST:$PORT/login"; then
    echo "build-guard: :$PORT up on $HEAD ✓ (pid $NEW_PID)"; exit 0
  fi
  sleep 2
done
echo "build-guard: :$PORT did not come up — check /tmp/anet-dash-$PORT.log" >&2
exit 1
