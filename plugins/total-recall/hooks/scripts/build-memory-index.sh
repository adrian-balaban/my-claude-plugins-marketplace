#!/usr/bin/env bash
# Single-pass awk scanner across both vaults. Reads only frontmatter.
set -euo pipefail

PERSONAL_VAULT="$HOME/.total-recall/personal-vault"
ORG_VAULT="$HOME/.total-recall/org/org-vault"
CACHE="$HOME/.total-recall/.index-cache.txt"

# Must stay in sync with EXCLUDED_DIRS in src/paths.ts — these directories are
# skipped by the TS reconcileIndex walk, and the cache builder must skip them
# too or it injects hidden memories (e.g. .obsidian, projects, templates) into
# the SessionStart index that the MCP tools never surface.
EXCLUDED_DIRS='projects templates .obsidian reference-docs in-progress completed'

# Build a find prune clause: \( -name projects -o -name templates -o ... \) -prune
# Names are simple tokens (no spaces/glob metachars), so unquoted word-splitting of
# $PRUNE into the find expression is safe and intentional.
PRUNE=""
for d in $EXCLUDED_DIRS; do
  if [ -z "$PRUNE" ]; then PRUNE="-name $d"; else PRUNE="$PRUNE -o -name $d"; fi
done

TMP=$(mktemp)
COUNT=0

process_vault() {
  local base="$1"
  local prefix="$2"
  [ -d "$base" ] || return
  while IFS= read -r -d '' mdfile; do
    local rel="${mdfile#$base/}"
    local key="$prefix${rel%.md}"
    local in_fm=0
    local title="" tags="" category=""
    category=$(dirname "$rel")
    [ "$category" = "." ] && category="knowledge"

    while IFS= read -r fmline; do
      if [ "$fmline" = "---" ]; then
        [ $in_fm -eq 0 ] && { in_fm=1; continue; } || break
      fi
      [ $in_fm -eq 0 ] && continue
      case "$fmline" in
        title:*) title="${fmline#title: }" ;;
        tags:*)  tags="${fmline#tags: }" ;;
      esac
    done < "$mdfile"

    [ -z "$title" ] && title=$(basename "$key")
    title="${title:0:40}"
    tags_short=$(echo "$tags" | awk -F',' '{for(i=1;i<=NF&&i<=3;i++) printf "%s%s",$i,(i<NF&&i<3?", ":""); if(NF>3) printf ", ..."}')

    echo "- $key: $title [$tags_short] ($category)" >> "$TMP"
    COUNT=$((COUNT + 1))
  done < <(find "$base" -type d \( $PRUNE \) -prune -o -name '*.md' -print0 2>/dev/null)
}

process_vault "$PERSONAL_VAULT" ""
process_vault "$ORG_VAULT" "org/"

mkdir -p "$(dirname "$CACHE")"
{ echo "$COUNT"; cat "$TMP"; } > "$CACHE"
rm -f "$TMP"
