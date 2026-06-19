#!/usr/bin/env bash
# Runs before context compaction. Extracts 0-3 reusable learnings from the session
# transcript and writes them directly to the personal vault.
#
# Storage is a direct file write (store-learning.cjs), NOT a nested `claude -p --mcp`
# call — that flag does not exist, so the previous version silently stored nothing.
# Files land on disk and are picked up by the next boot's reconcile_index / by an
# explicit rebuild_index.
set -euo pipefail

TRANSCRIPT="${CLAUDE_TRANSCRIPT_PATH:-}"

if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  echo '{"continue":true}'
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

EXTRACT_PROMPT='You are reviewing a Claude Code session transcript. Extract 0-3 distinct, reusable learnings worth storing as persistent memories.

For each learning output a JSON object on a single line:
{"title": "...", "content": "## Executive Summary\n\n...", "tags": [...], "category": "...", "importanceScore": 0.0-1.0}

Only output JSON lines. No prose. If nothing is worth storing, output nothing.

Rules:
- Only store things with long-term reuse value
- Include WHY, not just WHAT
- Do not store ephemeral task details'

# Extract via `claude -p` (valid), then write each JSON line straight to the vault.
# store-learning.cjs validates JSON, slugifies, and skips existing memories.
claude -p "$EXTRACT_PROMPT" < "$TRANSCRIPT" 2>/dev/null \
  | node "$SCRIPT_DIR/store-learning.cjs" 2>/dev/null || true

echo '{"continue":true}'