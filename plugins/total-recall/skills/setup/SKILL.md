---
name: setup
description: Use for standalone (non-plugin) Total Recall installs that need manual hook wiring in ~/.claude/settings.json, plus migration-from-v2 notes and known gotchas. For first-run onboarding (vault dirs, MCP registration, index build, org vault, vector search) use the `init` skill instead.
---

# Total Recall — Standalone Install & Reference

This skill covers what the `init` skill deliberately does **not**: manual hook wiring for standalone (non-plugin) installs, migration from v2, and the known-gotchas reference.

For first-run onboarding — vault directories, MCP server registration, initial index build, org-vault opt-in, optional vector search — run the **`init`** skill. It is state-aware and safe to re-run; the steps below assume that onboarding is already done or not needed.

## What is configurable — and what isn't

The vault location is **fixed** at `~/.total-recall` (`personal/` and `org/org-vault/`). The optional config file is `~/.total-recall/config.json`. What you *can* configure:

- Whether the **shared org vault** is enabled (cloned from a GitHub repo, branch `knowledge`)
  - Set `orgRepo` in `~/.total-recall/config.json` to point at your repo: `{ "orgRepo": "https://github.com/you/your-vault.git" }`
  - The org-vault privacy filter blocks all emails by default (fail-closed). If your team legitimately syncs work contacts, allow your company domain via `allowedEmailDomains`: `{ "orgRepo": "...", "allowedEmailDomains": ["yourcompany.com"] }`. Emails at any other domain are still blocked before push.
- **MCP server** registration
- **Hooks** (SessionStart / PostToolUse / PreCompact) — manual wiring below, standalone only
- **Optional vector search** (hybrid TF-IDF + embeddings)

## Prerequisites for standalone install

- Node.js v16+ (per `package.json` `engines`). Hook/MCP commands use the nvm node path — if your `node` lives elsewhere, adjust the path.
- `gh` CLI authenticated (`gh auth status`) — required for org vault GitHub sync. Token scopes needed: `repo` (read + write).

## Hook Wiring (manual step — standalone only)

If installed as a Claude Code **plugin** (recommended), its `hooks/hooks.json` is auto-loaded — **skip this section entirely**. The manual wiring below is only for a standalone MCP setup.

Add to `~/.claude/settings.json` under `"hooks"`. This is the **record format** (an object keyed by event name, matching the plugin's own `hooks/hooks.json`) — not an array:

```json
{
  "SessionStart": [
    {
      "hooks": [
        {"type":"command","command":"bash <plugin>/hooks/scripts/pull-org-vault.sh","timeout":30000},
        {"type":"command","command":"bash <plugin>/hooks/scripts/build-memory-index.sh","timeout":15000},
        {"type":"command","command":"bash <plugin>/hooks/scripts/load-memory-index.sh","timeout":5000},
        {"type":"command","command":"bash <plugin>/hooks/scripts/load-open-questions.sh","timeout":5000}
      ]
    }
  ],
  "PostToolUse": [
    {
      "matcher": "store_memory|update_memory|delete_memory",
      "hooks": [
        {"type":"command","command":"bash <plugin>/hooks/scripts/sync-org-memory.sh","timeout":30000}
      ]
    }
  ],
  "PreCompact": [
    {
      "hooks": [
        {"type":"command","command":"bash <plugin>/hooks/scripts/extract-and-store-memories.sh","timeout":60000}
      ]
    }
  ]
  // extract-and-store-memories.sh pipes JSON lines to hooks/scripts/store-learning.cjs,
  // which writes learnings directly to the personal vault as .md files — no MCP round-trip.
}
```

`build-memory-index.sh` must run **before** `load-memory-index.sh` on each SessionStart so the injected index reflects the latest vault state (not a stale cache from install time).

## Migration from v2

Existing `~/.total-recall` vaults are fully compatible. Run `rebuild_index` to re-scan.
`rebuild_index` is safe to run at any time — it now preserves `accessCount`/`lastAccessed` stats.

## Known Gotchas

- **`node` not on PATH**: `claude mcp add-json` must use the full path to the node binary (e.g. `~/.nvm/versions/node/v24.15.0/bin/node`), otherwise MCP server shows "Failed to connect"
- **`knowledge` branch must pre-exist**: `pull-org-vault.sh` clones the branch but won't create it. Initialize with at least one commit on the branch before first session start
- **YAML array format**: Memory tags must be in inline array format `[tag1, tag2]` on a single line — multi-line YAML sequences are not supported by the sync script's lightweight parser
- **Org tag**: tag memories with `org` to route to the shared org vault and trigger sync
- **Hook output format**: All hooks must output valid JSON `{"continue":true,...}` — any non-JSON output or non-zero exit causes the hook to fail silently (by design, to not block sessions). `sync-org-memory.cjs` logs its errors to `~/.total-recall/org/.sync-errors.log` so failures are still discoverable