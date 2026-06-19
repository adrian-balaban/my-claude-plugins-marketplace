#!/usr/bin/env bash
set -euo pipefail

PERSONAL_VAULT="$HOME/.total-recall/personal"
OQ_FILE=$(find "$PERSONAL_VAULT" \( -name "*open*question*" -o -name "*ambient*curiosity*" \) 2>/dev/null | head -1)

if [ -z "$OQ_FILE" ] || [ ! -f "$OQ_FILE" ]; then
  echo '{"continue":true}'
  exit 0
fi

SIZE=$(wc -c < "$OQ_FILE")
# Skip if > 3KB
if [ "$SIZE" -gt 3072 ]; then
  echo '{"continue":true}'
  exit 0
fi

CONTENT=$(cat "$OQ_FILE")
echo "{\"continue\":true,\"hookSpecificOutput\":{\"additionalContext\":$(echo "## Ambient Curiosity — Open Technical Questions\n\n$CONTENT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}}"
