#!/usr/bin/env bash
# Single-pass awk scanner across both vaults. Reads only frontmatter.
set -euo pipefail

PERSONAL_VAULT="$HOME/.total-recall/personal"
ORG_VAULT="$HOME/.total-recall/org/org-vault"
CACHE="$HOME/.total-recall/.index-cache.txt"

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
  done < <(find "$base" -name "*.md" -print0 2>/dev/null)
}

process_vault "$PERSONAL_VAULT" ""
process_vault "$ORG_VAULT" "org/"

mkdir -p "$(dirname "$CACHE")"
{ echo "$COUNT"; cat "$TMP"; } > "$CACHE"
rm -f "$TMP"
