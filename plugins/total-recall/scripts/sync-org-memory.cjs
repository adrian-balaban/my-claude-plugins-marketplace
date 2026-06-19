#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const TOTAL_RECALL_DIR = path.join(os.homedir(), '.total-recall');
const PERSONAL_VAULT = path.join(TOTAL_RECALL_DIR, 'personal');
const ORG_VAULT_DIR = path.join(TOTAL_RECALL_DIR, 'org');
const ORG_VAULT = path.join(ORG_VAULT_DIR, 'org-vault');
const BRANCH = 'knowledge';

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(TOTAL_RECALL_DIR, 'config.json'), 'utf8'));
  } catch { return {}; }
}
const config = loadConfig();
const ORG_REPO = config.orgRepo;
if (!ORG_REPO) {
  console.error('Error: orgRepo is not set. Add {"orgRepo": "https://github.com/you/your-vault.git"} to ~/.total-recall/config.json');
  process.exit(1);
}

// Inject gh token so git push/pull authenticate without prompting
try {
  const token = execSync('gh auth token', { encoding: 'utf8', stdio: 'pipe' }).trim();
  if (token) process.env.GITHUB_TOKEN = token;
} catch {}

// Run a git command safely — args passed as array to avoid shell injection
function git(cwd, args, opts = {}) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: opts.quiet ? 'pipe' : 'inherit',
    env: { ...process.env },
  });
  if (result.status !== 0 && !opts.allowFail) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr?.trim()}`);
  }
  return result.stdout ?? '';
}

// Allowed email domains — emails at these domains are treated as non-personal
// and may be pushed to the shared org vault. Configurable via
// `allowedEmailDomains` in ~/.total-recall/config.json (e.g. ["yourcompany.com"]).
// Default: empty → fail-closed, EVERY email is flagged and blocked from org sync.
// (A previous hardcoded employer-specific allowlist was unsafe for anyone else.)
const ALLOWED_DOMAINS = Array.isArray(config.allowedEmailDomains)
  ? config.allowedEmailDomains.filter(d => typeof d === 'string' && d.length)
  : [];

// Role titles that look like person names but are OK
const ROLE_TITLE_ALLOWLIST = ['product owner', 'tech lead', 'architect', 'scrum master'];

// Match any email-shaped substring, then compare the full host part against the
// allowlist in JS. A single negative-lookahead regex is unsafe here: a host like
// "yourcompany.com.evil.com" passes `@(?!yourcompany\.com)` because the lookahead
// sees "yourcompany.com" as a *prefix* of the host and fails to exclude it — a real
// bypass. Comparing the whole host (=== d || endsWith('.' + d)) closes it and is
// fail-closed when the allowlist is empty (every email is non-allowlisted → blocked).
const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

function isAllowedEmail(host, allowedDomains) {
  if (!allowedDomains.length) return false; // fail-closed
  const h = host.toLowerCase();
  return allowedDomains.some(d => {
    const dl = d.toLowerCase();
    return h === dl || h.endsWith('.' + dl); // allow the bare domain and its subdomains
  });
}

function findSuspiciousEmail(text, allowedDomains) {
  EMAIL_RE.lastIndex = 0;
  let m;
  while ((m = EMAIL_RE.exec(text)) !== null) {
    if (!isAllowedEmail(m[1], allowedDomains)) return m[0];
  }
  return null;
}
const PERSONAL_PRONOUN_RE = /\b(my|our|i am|i'm|we are|we're)\b/i;
// US/NANP: optional +country code, (xxx) xxx-xxxx or xxx-xxx-xxxx
const US_PHONE_RE = /(?:\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
// International: +country code then 7-13 more digits with separators (E.164-ish, max 15 total)
const INTL_PHONE_RE = /\+\d{1,3}[\s().-]*(?:\d[\s().-]*){6,12}\d/;
const PHONE_RE = new RegExp(`(?:${INTL_PHONE_RE.source}|${US_PHONE_RE.source})`);
// Common API keys / tokens — leaked credentials are the highest-risk PII for a public repo
const SECRET_TOKEN_RE = /\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[opsu]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})\b/;

function matterParse(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { data: {}, content: raw };
  const data = {};
  let lastArrayKey = null;
  for (const line of match[1].split('\n')) {
    // Skip blank lines and comments (a "# foo" line would otherwise create a bogus
    // array key via the "key:" branch). lastArrayKey survives blank lines so a block
    // sequence may span them.
    if (!line.trim() || line.trim().startsWith('#')) continue;
    // Block sequence item belonging to the most recently opened array key: "  - value"
    const blockItem = line.match(/^\s+-\s+(.+)$/);
    if (blockItem) {
      if (lastArrayKey) {
        if (!Array.isArray(data[lastArrayKey])) data[lastArrayKey] = [];
        data[lastArrayKey].push(blockItem[1].replace(/^["']|["']$/g, ''));
      }
      continue;
    }
    const [k, ...rest] = line.split(':');
    if (k && rest.length) {
      const val = rest.join(':').trim();
      if (val.startsWith('[')) {
        try {
          // Handle both JSON arrays ["a","b"] and unquoted YAML arrays [a, b, c]
          const jsonSafe = val.replace(/([[\s,])([a-zA-Z0-9_-]+)(?=[,\]])/g, '$1"$2"');
          data[k.trim()] = JSON.parse(jsonSafe);
        } catch { data[k.trim()] = val; }
        lastArrayKey = k.trim();
      } else if (val === '') {
        // "key:" with an empty inline value opens a block sequence (items follow as
        // "  - x"). Preset an empty array and remember the key; if no items follow it
        // is dropped below. Note "key:".split(':') yields rest=[''] (length 1), so THIS
        // branch — not the !rest.length one below — is what actually catches the opener.
        data[k.trim()] = [];
        lastArrayKey = k.trim();
      } else {
        data[k.trim()] = val.replace(/^["']|["']$/g, '');
        lastArrayKey = null;
      }
    } else if (k && !rest.length) {
      // "key:" with no inline value — opens a block array (items follow as "  - x").
      // Preset an empty array and remember the key; if no items follow, drop it.
      data[k.trim()] = [];
      lastArrayKey = k.trim();
    }
  }
  // Drop keys preset as empty arrays that never received block items (treat as absent)
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v) && v.length === 0) delete data[k];
  }
  return { data, content: raw.slice(match[0].length).trim() };
}

function privacyCheck(data, content) {
  const text = `${data.title ?? ''} ${content}`;
  if (SECRET_TOKEN_RE.test(text)) return 'secret token or API key detected';
  if (findSuspiciousEmail(text, ALLOWED_DOMAINS)) return 'suspicious email address detected';
  if (PERSONAL_PRONOUN_RE.test(data.title ?? '')) {
    const lc = (data.title ?? '').toLowerCase();
    if (!ROLE_TITLE_ALLOWLIST.some(r => lc.includes(r))) return 'personal pronoun in title';
  }
  if (PHONE_RE.test(text)) return 'phone number detected';
  return null;
}

function updateOrgIndex(key, data, content) {
  const indexPath = path.join(ORG_VAULT, 'index.json');
  let index = {};
  try { index = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch {}
  const now = new Date().toISOString();
  index[key] = {
    key,
    title: data.title ?? key,
    tags: Array.isArray(data.tags) ? data.tags : [],
    author: data.author ?? '',
    updated: data.updated ?? now,
    created: data.created ?? now,
    importanceScore: data.importanceScore ?? 0.5,
    contentPreview: content.slice(0, 500),
  };
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

function removeFromOrgIndex(key) {
  const indexPath = path.join(ORG_VAULT, 'index.json');
  let index = {};
  try { index = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch {}
  delete index[key];
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

async function main() {
  const key = process.argv[2];
  const deleteMode = process.argv.includes('--delete');

  if (!key) { console.error('Usage: sync-org-memory.cjs <key> [--delete]'); process.exit(1); }

  const relKey = key.replace(/^org\//, '');
  const orgFile = path.join(ORG_VAULT, relKey + '.md');
  const relFile = path.relative(ORG_VAULT_DIR, orgFile);     // e.g. org-vault/architecture/foo.md
  const relIndex = path.relative(ORG_VAULT_DIR, path.join(ORG_VAULT, 'index.json'));

  // store_memory writes org memories DIRECTLY into the org-vault working tree (which
  // lives on the `knowledge` branch after pull-org-vault.sh runs at session start). The
  // old code read from PERSONAL_VAULT here — where org files never live — so
  // existsSync was always false and every org sync silently exited 0 (a no-op). Sync
  // now commits the file that is already on disk, not a copy from personal.
  if (!deleteMode && !fs.existsSync(orgFile)) {
    console.error(`Org file not found: ${orgFile}`);
    process.exit(0);
  }

  // Keep the org-vault on the knowledge branch (its steady state). We deliberately do
  // NOT stash or restore the original branch: store_memory writes into this working
  // tree, so staying on knowledge means the next store lands in the right place and
  // the next sync commits it directly. Stashing would remove the very file we commit.
  try {
    git(ORG_VAULT_DIR, ['checkout', BRANCH], { quiet: true });
  } catch (e) {
    // checkout can refuse if an untracked org file clashes with a tracked one on
    // knowledge (rare, only if the working tree drifted off knowledge). Skip rather
    // than risk pushing from the wrong branch.
    console.error(`Cannot switch org vault to '${BRANCH}': ${e.message}`);
    return;
  }
  // Best-effort fast-forward. If it fails (e.g. an untracked-file clash with an
  // incoming path, or the remote advanced non-ff) we still try to commit locally; the
  // push will fail loudly if the remote has advanced, and we reset the local commit on
  // failure so the branch stays clean for the next attempt.
  git(ORG_VAULT_DIR, ['pull', '--ff-only', 'origin', BRANCH], { quiet: true, allowFail: true });

  if (deleteMode) {
    if (fs.existsSync(orgFile)) {
      try { fs.unlinkSync(orgFile); } catch {}
    }
    removeFromOrgIndex(relKey);
    git(ORG_VAULT_DIR, ['add', '--', relFile, relIndex], { quiet: true });
    // Only commit if something actually staged (the file deletion and/or the index
    // change). Idempotent: a repeat --delete on an already-removed key is a no-op.
    const staged = git(ORG_VAULT_DIR, ['diff', '--cached', '--name-only'], { quiet: true, allowFail: true }).trim();
    if (!staged) { console.log(`Nothing to delete for ${key}.`); return; }
    git(ORG_VAULT_DIR, ['commit', '-m', `chore(total-recall): remove ${key}`], { quiet: true });
    try {
      git(ORG_VAULT_DIR, ['push', 'origin', BRANCH], { quiet: true });
      console.log(`Removed ${key} from org vault.`);
    } catch (pushErr) {
      // Undo exactly our commit (soft keeps the change staged for a retry). Only safe
      // because we know HEAD advanced by one on the commit above; we never reach here
      // if commit itself failed (it would have thrown before push).
      git(ORG_VAULT_DIR, ['reset', '--soft', 'HEAD~1'], { quiet: true, allowFail: true });
      throw pushErr;
    }
    return;
  }

  // Store mode: privacy + tag checks BEFORE staging anything (never stage a file that
  // fails — staging it would risk a later blind `git add -A` sweeping it up).
  const raw = fs.readFileSync(orgFile, 'utf8');
  const { data, content } = matterParse(raw);
  const tags = Array.isArray(data.tags) ? data.tags : [];

  if (!tags.includes('org')) {
    console.log(`Skipping ${key} — not tagged org`);
    return;
  }
  if (tags.includes('personal')) {
    console.error(`Rejecting ${key} — tagged both org and personal`);
    return;
  }

  const privacyIssue = privacyCheck(data, content);
  if (privacyIssue) {
    console.error(`Privacy filter blocked ${key}: ${privacyIssue}`);
    return;
  }

  updateOrgIndex(relKey, data, content);
  git(ORG_VAULT_DIR, ['add', '--', relFile, relIndex], { quiet: true });
  const staged = git(ORG_VAULT_DIR, ['diff', '--cached', '--name-only'], { quiet: true, allowFail: true }).trim();
  if (!staged) { console.log(`Nothing to sync for ${key} (already up to date).`); return; }
  git(ORG_VAULT_DIR, ['commit', '-m', `chore(total-recall): sync ${key}`], { quiet: true });
  try {
    git(ORG_VAULT_DIR, ['push', 'origin', BRANCH], { quiet: true });
    console.log(`Synced ${key} to org vault.`);
  } catch (pushErr) {
    git(ORG_VAULT_DIR, ['reset', '--soft', 'HEAD~1'], { quiet: true, allowFail: true });
    throw pushErr;
  }
}

main().catch(e => {
  // Log to a persistent file so sync failures are discoverable — the PostToolUse hook
  // backgrounds this process, so stderr is otherwise lost. Exit 0 keeps the hook
  // non-blocking (see setup/SKILL.md "Hook output format" gotcha).
  const logPath = path.join(os.homedir(), '.total-recall', 'org', '.sync-errors.log');
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${e.message}\n`);
  } catch {}
  console.error(e.message);
  process.exit(0);
});
