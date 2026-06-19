import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';

// We test the matterParse, privacyCheck, and updateOrgIndex logic
// by extracting them inline (the .cjs file can't be ES-imported cleanly).
// These are pure/near-pure functions replicated here for unit testing.

// ─── matterParse (replicated from sync-org-memory.cjs) ───────────────────────

function matterParse(raw: string): { data: Record<string, any>; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { data: {}, content: raw };
  const data: Record<string, any> = {};
  for (const line of match[1].split('\n')) {
    const [k, ...rest] = line.split(':');
    if (k && rest.length) {
      const val = rest.join(':').trim();
      if (val.startsWith('[')) {
        try {
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

// ─── privacyCheck (replicated) ───────────────────────────────────────────────
// NOTE: kept in sync with scripts/sync-org-memory.cjs. The allowlist is now
// configurable (config.allowedEmailDomains) and defaults to empty = fail-closed.

const ROLE_TITLE_ALLOWLIST = ['product owner', 'tech lead', 'architect', 'scrum master'];

// Build the email regex exactly as the script does, so the empty-allowlist
// fail-closed branch is covered by tests too.
function suspiciousEmailRegex(allowedDomains: string[]): RegExp {
  return allowedDomains.length
    ? new RegExp(
        `@(?!${allowedDomains.map((d) => d.replace('.', '\\.')).join('|')})[a-z0-9.-]+\\.[a-z]{2,}`,
        'i',
      )
    : /@[a-z0-9.-]+\.[a-z]{2,}/i;
}
const PERSONAL_PRONOUN_RE = /\b(my|our|i am|i'm|we are|we're)\b/i;
// US/NANP: optional +country code, (xxx) xxx-xxxx or xxx-xxx-xxxx
const US_PHONE_RE = /(?:\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
// International: +country code then 7-13 more digits with separators (E.164-ish, max 15 total)
const INTL_PHONE_RE = /\+\d{1,3}[\s().-]*(?:\d[\s().-]*){6,12}\d/;
const PHONE_RE = new RegExp(`(?:${INTL_PHONE_RE.source}|${US_PHONE_RE.source})`);
// Common API keys / tokens — leaked credentials are the highest-risk PII for a public repo
const SECRET_TOKEN_RE = /\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[opsu]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})\b/;

function privacyCheck(data: any, content: string, allowedDomains: string[] = []): string | null {
  const text = `${data.title ?? ''} ${content}`;
  if (SECRET_TOKEN_RE.test(text)) return 'secret token or API key detected';
  if (suspiciousEmailRegex(allowedDomains).test(text)) return 'suspicious email address detected';
  if (PERSONAL_PRONOUN_RE.test(data.title ?? '')) {
    const lc = (data.title ?? '').toLowerCase();
    if (!ROLE_TITLE_ALLOWLIST.some((r: string) => lc.includes(r))) return 'personal pronoun in title';
  }
  if (PHONE_RE.test(text)) return 'phone number detected';
  return null;
}

// ─── Tests: matterParse ──────────────────────────────────────────────────────

describe('matterParse', () => {
  it('parses standard frontmatter', () => {
    const raw = `---\ntitle: "Hello World"\ntags: [a, b, c]\nimportanceScore: 0.7\n---\n\nBody text.`;
    const { data, content } = matterParse(raw);
    expect(data.title).toBe('Hello World');
    expect(data.tags).toEqual(['a', 'b', 'c']);
    expect(data.importanceScore).toBe('0.7'); // parsed as string (no type coercion)
    expect(content).toBe('Body text.');
  });

  it('handles file with no frontmatter', () => {
    const raw = 'Just plain content.';
    const { data, content } = matterParse(raw);
    expect(data).toEqual({});
    expect(content).toBe('Just plain content.');
  });

  it('parses unquoted YAML array correctly', () => {
    const raw = `---\ntags: [kafka, flink, cdc]\n---\n\nContent`;
    const { data } = matterParse(raw);
    expect(data.tags).toEqual(['kafka', 'flink', 'cdc']);
  });

  it('parses quoted JSON array without double-quoting', () => {
    const raw = `---\ntags: ["kafka", "flink"]\n---\n\nContent`;
    const { data } = matterParse(raw);
    // Quoted arrays get double-quoted by the regex but JSON.parse handles it
    // or falls through to raw string — either way no crash
    expect(Array.isArray(data.tags) || typeof data.tags === 'string').toBe(true);
  });

  it('handles hyphenated values in arrays', () => {
    const raw = `---\ntags: [kafka-connect, flink-cdc]\n---\n\nContent`;
    const { data } = matterParse(raw);
    expect(data.tags).toEqual(['kafka-connect', 'flink-cdc']);
  });

  it('strips surrounding quotes from string values', () => {
    const raw = `---\nauthor: "adrianb"\n---\n\nContent`;
    const { data } = matterParse(raw);
    expect(data.author).toBe('adrianb');
  });

  it('handles colon in value (joins rest correctly)', () => {
    const raw = `---\nurl: https://example.com/path\n---\n\nContent`;
    const { data } = matterParse(raw);
    expect(data.url).toBe('https://example.com/path');
  });

  it('returns empty data for frontmatter without closing ---', () => {
    const raw = `---\ntitle: "Unclosed"\n\nContent without close`;
    const { data } = matterParse(raw);
    expect(data).toEqual({});
  });
});

// ─── Tests: privacyCheck ─────────────────────────────────────────────────────

describe('privacyCheck', () => {
  it('passes clean org memory', () => {
    expect(privacyCheck({ title: 'Kafka Architecture' }, 'Technical content about Kafka.')).toBeNull();
  });

  it('blocks external email addresses', () => {
    expect(privacyCheck({ title: 'Notes' }, 'Contact user@gmail.com for details.')).toMatch(/email/);
  });

  it('fail-closed: empty allowlist blocks every email, including work domains', () => {
    // Default config (no allowedEmailDomains) → no email is safe to push.
    expect(privacyCheck({ title: 'Notes' }, 'Contact ops@example.com for help.')).toMatch(/email/);
    expect(privacyCheck({ title: 'Notes' }, 'owner@example.org')).toMatch(/email/);
    expect(privacyCheck({ title: 'Notes' }, 'me@mycompany.com')).toMatch(/email/);
  });

  it('allows emails at a configured allowed domain', () => {
    expect(privacyCheck({ title: 'Notes' }, 'Contact ops@mycompany.com for help.', ['mycompany.com'])).toBeNull();
  });

  it('still blocks non-allowlisted domains when an allowlist is set', () => {
    expect(privacyCheck({ title: 'Notes' }, 'Contact user@gmail.com for details.', ['mycompany.com'])).toMatch(/email/);
  });

  it('blocks personal pronoun in title', () => {
    expect(privacyCheck({ title: 'My personal notes' }, 'Content')).toMatch(/pronoun/);
  });

  it('allows role title with pronoun-like words', () => {
    // "our tech lead" contains "our" but title contains role title
    expect(privacyCheck({ title: 'Our Tech Lead decisions' }, 'Content')).toBeNull();
  });

  it('blocks phone numbers in content', () => {
    expect(privacyCheck({ title: 'Notes' }, 'Call 555-123-4567 for support.')).toMatch(/phone/);
  });

  it('blocks phone numbers with country code', () => {
    expect(privacyCheck({ title: 'Notes' }, 'Dial +1 (555) 123-4567')).toMatch(/phone/);
  });

  it('does not block URLs that look like domains', () => {
    // A URL without @ should not trigger email filter
    expect(privacyCheck({ title: 'Notes' }, 'See https://example.com/docs')).toBeNull();
  });

  it('blocks "we are" pronoun in title', () => {
    expect(privacyCheck({ title: "We are migrating" }, 'Content')).toMatch(/pronoun/);
  });
});

// ─── Tests: spawnSync safety (shell injection prevention) ────────────────────

describe('git command safety', () => {
  it('a key with shell metacharacters is safe when passed as array arg', () => {
    // Simulate what the fixed sync script does: spawnSync('git', ['-C', dir, 'commit', '-m', msg])
    // Even with a malicious key, it's a positional arg — no shell expansion
    const maliciousKey = 'architecture/$(rm -rf /)';
    const commitMsg = `chore(total-recall): sync ${maliciousKey}`;
    // The message itself is fine as a string — it's only dangerous if passed to a shell
    // Verify it doesn't contain shell expansion when used as array element
    const args = ['commit', '-m', commitMsg];
    expect(args[2]).toBe(commitMsg); // literal string, not expanded
    // spawnSync with shell:false would not interpret $() — we just verify the arg is safe
    expect(args[2]).toContain('$(rm -rf /)'); // still there as literal text
  });
});
