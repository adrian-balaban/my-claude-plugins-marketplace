---
name: init
description: Use when the user wants to initialize Total Recall for the first time. Runs a state-aware checklist that detects what is already set up and only acts on what is missing — vault directories, config.json, MCP server registration, index build, and optionally org vault and vector search.
---

# Total Recall — First-Run Initialization

Run each step in order. Each step checks current state before acting — safe to re-run on a partially set-up installation.

## Step 1 — Detect plugin path

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
if [ -z "$PLUGIN_ROOT" ]; then
  # Fallback: find dist/index.js from the registered MCP server config
  PLUGIN_ROOT=$(claude mcp get total-recall 2>/dev/null | grep -o '"[^"]*dist/index.js"' | sed 's|/dist/index.js"||;s|^"||')
fi
```

If `PLUGIN_ROOT` is still empty, ask the user: "What is the path to the total-recall plugin directory?"

## Step 2 — Create vault directories

```bash
mkdir -p ~/.total-recall/personal/{architecture,decisions,troubleshooting,meetings,knowledge,journal}
mkdir -p ~/.total-recall/org
```

If `~/.total-recall/personal` already exists and is non-empty, skip and say "Vault directories already exist."

## Step 3 — Register MCP server

Check if already registered:
```bash
claude mcp get total-recall 2>/dev/null
```

If not registered:
```bash
NODE=$(~/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1 || which node)
claude mcp add-json total-recall "{\"type\":\"stdio\",\"command\":\"$NODE\",\"args\":[\"$PLUGIN_ROOT/dist/index.js\"]}" --scope user
```

Verify with `claude mcp get total-recall` — if it shows "Failed to connect", the node path is wrong. Show the user the path used and ask them to confirm or correct it.

## Step 4 — Build initial index

```bash
bash "$PLUGIN_ROOT/hooks/scripts/build-memory-index.sh"
```

## Step 5 — Org vault (optional)

Ask: "Do you want to enable the shared org vault for syncing `org`-tagged memories to GitHub?"

If **yes**:
1. Ask: "GitHub repo URL for the org vault?" (full HTTPS URL ending in `.git`)
2. Ask: "Branch name?" (default: `knowledge`) — remind the user this branch must already exist with at least one commit
3. (Optional) Ask: "Any work email domain to allow in org-vault sync? The privacy filter blocks ALL emails by default. Leave blank to keep the safe default." If they give one (e.g. `yourcompany.com`), include `allowedEmailDomains`.
4. Write config:
```bash
echo '{"orgRepo":"<URL>","allowedEmailDomains":["<domain>"]}' > ~/.total-recall/config.json
```
Omit `allowedEmailDomains` if they left it blank — the default (empty) blocks every email from being pushed to the shared vault.
5. Clone vault:
```bash
bash "$PLUGIN_ROOT/hooks/scripts/pull-org-vault.sh"
```
If clone fails, show the error and suggest: check that the branch exists (`git ls-remote <URL> <branch>`), and that `gh auth status` shows the correct account.

If **no**: say "Org vault skipped. You can enable it later by setting `orgRepo` in `~/.total-recall/config.json`."

## Step 6 — Vector search (optional)

Ask: "Do you want to enable hybrid vector search (TF-IDF + embeddings via HuggingFace)? Requires ~200 MB download on first use."

If **yes**:
```bash
cd "$PLUGIN_ROOT"
npm install @huggingface/transformers sqlite-vec better-sqlite3
npm run build
```

If **no**: say "Vector search skipped. Plugin uses TF-IDF + Ebbinghaus decay by default. You can enable it later by running the npm installs above."

## Step 7 — Verify

```bash
# Confirm the bundle was built and the server is registered (no "Failed to connect")
ls "$PLUGIN_ROOT/dist/index.js" && claude mcp get total-recall
```

Then summarize what was set up, what was skipped, and any manual steps still needed.

## Notes

- This skill only covers **first-run initialization**. For standalone (non-plugin) installs that need manual hook wiring in `~/.claude/settings.json`, plus migration-from-v2 notes and known gotchas, use the `setup` skill.
- Plugin installs (via `claude plugin install`) auto-load `hooks/hooks.json` — no manual hook wiring needed.
- `build-memory-index.sh` is safe to re-run at any time.
