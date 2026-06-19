#!/usr/bin/env bash
set -euo pipefail

ORG_VAULT="$HOME/.total-recall/org"
BRANCH="knowledge"
CONFIG_FILE="$HOME/.total-recall/config.json"
ORG_REPO=$(python3 -c "import json,sys; print(json.load(open('$CONFIG_FILE')).get('orgRepo',''))" 2>/dev/null || echo "")
if [ -z "$ORG_REPO" ]; then
  echo '{"continue":true,"hookSpecificOutput":{"additionalContext":"Org vault skipped: orgRepo not set in ~/.total-recall/config.json"}}'
  exit 0
fi

# Use gh for authenticated git operations
export GIT_ASKPASS=""
export GIT_TERMINAL_PROMPT=0
GH_TOKEN=$(gh auth token 2>/dev/null || echo "")
[ -n "$GH_TOKEN" ] && export GITHUB_TOKEN="$GH_TOKEN"

mkdir -p "$ORG_VAULT"

if [ ! -d "$ORG_VAULT/.git" ]; then
  if ! gh repo clone "$ORG_REPO" "$ORG_VAULT" -- --branch "$BRANCH" --depth 1 2>/dev/null; then
    if ! git clone --branch "$BRANCH" --depth 1 "$ORG_REPO" "$ORG_VAULT" 2>/dev/null; then
      echo '{"continue":true,"hookSpecificOutput":{"additionalContext":"Failed to clone org vault."}}'
      exit 0
    fi
  fi
  echo '{"continue":true,"hookSpecificOutput":{"additionalContext":"Org vault cloned."}}'
  exit 0
fi

cd "$ORG_VAULT"
BEFORE=$(git rev-parse HEAD 2>/dev/null || echo "")
git pull --ff-only origin "$BRANCH" 2>/dev/null || true
AFTER=$(git rev-parse HEAD 2>/dev/null || echo "")

if [ "$BEFORE" = "$AFTER" ]; then
  echo '{"continue":true,"hookSpecificOutput":{"additionalContext":"Org vault up-to-date."}}'
else
  echo "{\"continue\":true,\"hookSpecificOutput\":{\"additionalContext\":\"Org vault updated: $BEFORE -> $AFTER\"}}"
fi
