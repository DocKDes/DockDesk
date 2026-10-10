#!/bin/sh
# Starts DockDesk and checks that it answers and serves its page files, without needing Docker or a browser.
#   sh packaging/smoke-test.sh                  the installed copy (/opt/dockdesk, from the .deb)
#   sh packaging/smoke-test.sh /path/to/folder  a folder containing server.js (a checkout, or an unpacked release)
set -eu
DIR=${1:-/opt/dockdesk}
LOG=$(mktemp)
DOCKDESK_NO_OPEN=1 node "$DIR/server.js" >"$LOG" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true; rm -f "$LOG"' EXIT INT TERM
n=0
until grep -q 'http://127.0.0.1:[0-9]*/?t=' "$LOG"; do
  n=$((n + 1))
  if [ "$n" -gt 50 ] || ! kill -0 $PID 2>/dev/null; then echo "DockDesk did not start:"; cat "$LOG"; exit 1; fi
  sleep 0.2
done
BASE=$(grep -o 'http://127.0.0.1:[0-9]*' "$LOG" | head -1)
# the page, every module and style it loads, and a refusal without the token
node -e '
const fs = require("fs"), base = process.argv[1], dir = process.argv[2] + "/public"
const walk = (d) => fs.readdirSync(dir + d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(d + "/" + e.name) : [d + "/" + e.name])
const files = ["/", ...walk("").filter((f) => /\.(js|css|png)$/.test(f))] // every file the page can load
;(async () => {
  for (const f of files) { const r = await fetch(base + f); if (!r.ok) { console.error(f + " -> HTTP " + r.status); process.exit(1) } }
  const r = await fetch(base + "/api/ping", { method: "POST", body: "[]" })
  if (r.status !== 401) { console.error("/api/ping without a token returned " + r.status + ", expected 401"); process.exit(1) }
  console.log("smoke test passed: " + base)
})()' "$BASE" "$DIR"
