#!/usr/bin/env bash
set -euo pipefail

HOOK_INPUT="${1:-}"

KEY=$(echo "$HOOK_INPUT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_result",{}).get("key",""))' 2>/dev/null || echo "")

if [ -z "$KEY" ]; then
  echo '{"continue":true}'
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOCK="$HOME/.total-recall/org/.sync.lock"
mkdir -p "$(dirname "$LOCK")"

# Run the git sync under an exclusive flock so concurrent PostToolUse invocations
# serialize instead of racing on the same org-vault repo (stash/checkout/push). The
# flock blocks, but the whole subshell is backgrounded so the hook never blocks the
# session; queued syncs simply run one after another and no key's sync is dropped.
# build-memory-index only writes the local cache file, so it stays outside the lock.
(
  flock -x 9
  node "$PLUGIN_ROOT/scripts/sync-org-memory.cjs" "$KEY"
) 9>"$LOCK" &

bash "$PLUGIN_ROOT/hooks/scripts/build-memory-index.sh" &

echo '{"continue":true}'
