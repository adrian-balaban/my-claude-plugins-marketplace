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

// With a non-empty allowlist, the negative lookahead exempts those domains.
// With an empty allowlist we MUST drop the lookahead — `@(?!)` always fails
// (empty matches everywhere), which would let every email through. Instead we
// match every email so the default is fail-closed.
const SUSPICIOUS_EMAIL_RE = ALLOWED_DOMAINS.length
  ? new RegExp(
      `@(?!${ALLOWED_DOMAINS.map(d => d.replace('.', '\\.')).join('|')})[a-z0-9.-]+\\.[a-z]{2,}`,
      'i',
    )
  : /@[a-z0-9.-]+\.[a-z]{2,}/i;
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
  for (const line of match[1].split('\n')) {
    const [k, ...rest] = line.split(':');
    if (k && rest.length) {
      const val = rest.join(':').trim();
      if (val.startsWith('[')) {
        try {
          // Handle both JSON arrays ["a","b"] and unquoted YAML arrays [a, b, c]
          const jsonSafe = val.replace(/([[\s,])([a-zA-Z0-9_-]+)(?=[,\]])/g, '$1"$2"');
          data[k.trim()] = JSON.parse(jsonSafe);
        } catch { data[k.trim()] = val; }
      } else {
        data[k.trim()] = val.replace(/^["']|["']$/g, '');
      }
    }
  }
  return { data, content: raw.slice(match[0].length).trim() };
}

function privacyCheck(data, content) {
  const text = `${data.title ?? ''} ${content}`;
  if (SECRET_TOKEN_RE.test(text)) return 'secret token or API key detected';
  if (SUSPICIOUS_EMAIL_RE.test(text)) return 'suspicious email address detected';
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

  const filePath = path.join(PERSONAL_VAULT, key.replace(/^org\//, '') + '.md');
  if (!deleteMode && !fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`); process.exit(0);
  }

  let originalBranch = 'main';
  try {
    originalBranch = git(ORG_VAULT_DIR, ['rev-parse', '--abbrev-ref', 'HEAD'], { quiet: true }).trim();
  } catch {}

  let stashed = false;

  try {
    // Stash if dirty
    try {
      const status = git(ORG_VAULT_DIR, ['status', '--porcelain'], { quiet: true });
      if (status.trim()) {
        git(ORG_VAULT_DIR, ['stash']);
        stashed = true;
      }
    } catch {}

    // Checkout knowledge branch
    git(ORG_VAULT_DIR, ['checkout', BRANCH], { quiet: true });
    git(ORG_VAULT_DIR, ['pull', '--ff-only', 'origin', BRANCH], { quiet: true });

    if (deleteMode) {
      const orgFile = path.join(ORG_VAULT, key.replace(/^org\//, '') + '.md');
      if (fs.existsSync(orgFile)) {
        fs.unlinkSync(orgFile);
        removeFromOrgIndex(key.replace(/^org\//, ''));
        git(ORG_VAULT_DIR, ['add', '-A']);
        git(ORG_VAULT_DIR, ['commit', '-m', `chore(total-recall): remove ${key}`], { allowFail: true });
        try {
          git(ORG_VAULT_DIR, ['push', 'origin', BRANCH], { quiet: true });
        } catch (pushErr) {
          // Undo local commit so branch stays clean
          git(ORG_VAULT_DIR, ['reset', 'HEAD~1'], { quiet: true });
          throw pushErr;
        }
      }
    } else {
      const raw = fs.readFileSync(filePath, 'utf8');
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

      const relKey = key.replace(/^org\//, '');
      const destDir = path.join(ORG_VAULT, path.dirname(relKey));
      fs.mkdirSync(destDir, { recursive: true });
      const destFile = path.join(ORG_VAULT, relKey + '.md');
      fs.copyFileSync(filePath, destFile);
      updateOrgIndex(relKey, data, content);

      git(ORG_VAULT_DIR, ['add', '-A']);
      git(ORG_VAULT_DIR, ['commit', '-m', `chore(total-recall): sync ${key}`], { quiet: true, allowFail: true });
      try {
        git(ORG_VAULT_DIR, ['push', 'origin', BRANCH], { quiet: true });
        console.log(`Synced ${key} to org vault.`);
      } catch (pushErr) {
        // Undo local commit so branch stays clean for next attempt
        git(ORG_VAULT_DIR, ['reset', 'HEAD~1'], { quiet: true });
        throw pushErr;
      }
    }
  } finally {
    // Restore original branch
    try {
      git(ORG_VAULT_DIR, ['checkout', originalBranch], { quiet: true });
    } catch {}
    // Restore stash — warn loudly if it fails (merge conflict etc.)
    if (stashed) {
      try {
        git(ORG_VAULT_DIR, ['stash', 'pop'], { quiet: true });
      } catch (e) {
        console.error(`WARNING: git stash pop failed — your changes are in the stash. Run 'git -C ${ORG_VAULT_DIR} stash list' to inspect.`);
      }
    }
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
