#!/usr/bin/env node
'use strict';

// PreCompact helper: writes extracted learnings directly to the personal vault as
// frontmatter .md files. Reads one JSON object per line on stdin (fields: title,
// content, tags, category, importanceScore) and writes each to
// ~/.total-recall/personal/<category>/<slug>.md.
//
// This replaces the old `claude -p ... --mcp` storage path (the --mcp flag does not
// exist, so storage was a silent no-op). Direct writes avoid any nested Claude
// process and any MCP round-trip; the file is picked up by the next boot's
// reconcile_index or an explicit rebuild_index.
//
// Existing memories are NEVER overwritten — if a slug already exists, the line is
// skipped (the extract prompt may re-surface similar learnings across sessions).

const fs = require('fs');
const path = require('path');
const os = require('os');

const VAULT = path.join(os.homedir(), '.total-recall', 'personal');

function slugify(s) {
  return String(s || 'untitled')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
}

// Minimal YAML scalar emitter for the frontmatter values we produce. Good enough
// for titles/tags/numbers — we don't need a full YAML library here.
function yamlScalar(v) {
  if (Array.isArray(v)) return '[' + v.map(yamlScalar).join(', ') + ']';
  if (typeof v === 'string') {
    return /[:#\[\]{}&*!|>'"%@`,]/.test(v) || /^\s|\s$/.test(v) ? JSON.stringify(v) : v;
  }
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v ?? '');
}

function fmStringify(body, data) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    lines.push(`${k}: ${yamlScalar(v)}`);
  }
  lines.push('---', '', body.endsWith('\n') ? body : body + '\n');
  return lines.join('\n');
}

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const now = new Date().toISOString();
  let written = 0, skipped = 0, errors = 0;
  for (const line of input.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try { obj = JSON.parse(trimmed); } catch { errors++; continue; }
    if (!obj || !obj.title || !obj.content) { errors++; continue; }

    const category = obj.category && /^[a-z0-9_-]+$/i.test(obj.category) ? obj.category : 'knowledge';
    const dir = path.join(VAULT, category);
    try { fs.mkdirSync(dir, { recursive: true }); } catch { errors++; continue; }

    const slug = slugify(obj.title);
    const filePath = path.join(dir, `${slug}.md`);
    if (fs.existsSync(filePath)) { skipped++; continue; } // never overwrite from extract

    const fm = {
      title: obj.title,
      tags: Array.isArray(obj.tags) ? obj.tags : [],
      author: os.userInfo().username,
      sessions: [],
      created: now,
      updated: now,
      importanceScore: typeof obj.importanceScore === 'number' ? obj.importanceScore : 0.5,
    };
    const body = `\n${obj.content}`;
    try {
      fs.writeFileSync(filePath, fmStringify(body, fm));
      written++;
    } catch { errors++; }
  }
  // Keep stdout clean (hooks must not spam it). Summary goes to stderr for debugging.
  process.stderr.write(`store-learning: ${written} written, ${skipped} skipped (existing), ${errors} errors\n`);
});