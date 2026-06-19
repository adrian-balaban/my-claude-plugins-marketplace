#!/usr/bin/env bash
set -euo pipefail

# Claude Code delivers the PostToolUse payload as JSON on STDIN, not as argv.
# The old code read "$1" (always empty here) and then a nonexistent "tool_result"
# field, so KEY was always empty, the early-return fired, and org sync was a
# silent no-op for EVERY store/update/delete. Read stdin once and parse it for
# real.
HOOK_INPUT=$(cat)

# tool_name is "mcp__<server>__<tool>" for MCP tools; the matcher is on the
# "store_memory|update_memory|delete_memory" suffix. tool_response for an MCP
# tool is the MCP envelope {content:[{type:"text", text:"<json>"}]} whose text
# is the tool's own JSON return (e.g. {"key":"org/architecture/foo",...}); some
# transports send the object unwrapped. Handle both, then fall back to
# tool_input.key (present on the request side) if the response carried no key.
# Emit "<key>\x1f<delete-flag>" (\x1f = ASCII unit separator) so bash can split it
# without a second python call — see the comment at the `read` below for why \x1f
# (not a tab) is the delimiter.
PARSED=$(printf '%s' "$HOOK_INPUT" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    d = {}
tool_name = d.get("tool_name") or ""
resp = d.get("tool_response")
key = ""
if isinstance(resp, dict):
    content = resp.get("content")
    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                try:
                    p = json.loads(item.get("text") or "")
                except Exception:
                    p = None
                if isinstance(p, dict) and p.get("key"):
                    key = p["key"]
                    break
    if not key and resp.get("key"):
        key = resp["key"]
if not key:
    tin = d.get("tool_input")
    if isinstance(tin, dict) and tin.get("key"):
        key = tin["key"]
print("%s\x1f%d" % (key, 1 if tool_name.endswith("delete_memory") else 0))
' 2>/dev/null || true)

# \x1f (ASCII unit separator) is non-whitespace. bash `read` strips a LEADING
# IFS-whitespace delimiter, so a TAB here would turn an empty key into the delete-flag
# value and the -z guard would misfire (running the sync with "0"/"1" as the key).
# With \x1f an empty key stays empty. Keys are slugified paths and never contain \x1f,
# so the delimiter is collision-free.
IFS=$'\x1f' read -r KEY DELETE_FLAG <<< "$PARSED"

if [ -z "$KEY" ]; then
  echo '{"continue":true}'
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOCK="$HOME/.total-recall/org/.sync.lock"
mkdir -p "$(dirname "$LOCK")"

# Run the git sync under an exclusive flock so concurrent PostToolUse invocations
# serialize instead of racing on the same org-vault repo (checkout/pull/push). The
# flock blocks, but the whole subshell is backgrounded so the hook never blocks the
# session; queued syncs simply run one after another and no key's sync is dropped.
# build-memory-index only writes the local cache file, so it stays outside the lock.
if [ "$DELETE_FLAG" = "1" ]; then
  (
    flock -x 9
    node "$PLUGIN_ROOT/scripts/sync-org-memory.cjs" "$KEY" --delete
  ) 9>"$LOCK" &
else
  (
    flock -x 9
    node "$PLUGIN_ROOT/scripts/sync-org-memory.cjs" "$KEY"
  ) 9>"$LOCK" &
fi

bash "$PLUGIN_ROOT/hooks/scripts/build-memory-index.sh" &

echo '{"continue":true}'