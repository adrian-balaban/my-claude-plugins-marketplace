import * as fs from 'fs';
import * as path from 'path';
import { parseFrontmatter } from './frontmatter.js';
import {
  PERSONAL_VAULT,
  ORG_VAULT,
  EXCLUDED_DIRS,
  ensureDir,
} from './paths.js';
import { memIndex, errors } from './state.js';
import type { MemoryFrontmatter } from './types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export function keyFromPath(filePath: string, isOrg: boolean): string {
  const base = isOrg ? ORG_VAULT : PERSONAL_VAULT;
  const rel = path.relative(base, filePath).replace(/\.md$/, '');
  return isOrg ? `org/${rel}` : rel;
}

export function tokenEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Full vault scan ─────────────────────────────────────────────────────────

// Reconcile the in-memory index against disk: add new/updated files, drop keys
// whose file no longer exists, and preserve runtime access stats for survivors.
// Used both at boot (so orphaned files from a missed flush and newly pulled org
// memories surface) and by rebuild_index (so it no longer wipes accessCount).
export function reconcileIndex() {
  const before = new Set(Object.keys(memIndex));
  const seen = new Set<string>();
  const walk = (dir: string, isOrg: boolean) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!EXCLUDED_DIRS.has(e.name.toLowerCase())) walk(fp, isOrg);
      } else if (e.name.endsWith('.md')) {
        indexFile(fp, isOrg);
        seen.add(keyFromPath(fp, isOrg));
      }
    }
  };
  ensureDir(PERSONAL_VAULT);
  ensureDir(ORG_VAULT);
  walk(PERSONAL_VAULT, false);
  walk(ORG_VAULT, true);
  for (const key of before) if (!seen.has(key)) delete memIndex[key];
}

export function indexFile(filePath: string, isOrg: boolean) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const { data, content } = parseFrontmatter(raw);
    const fm = data as Partial<MemoryFrontmatter>;
    const key = keyFromPath(filePath, isOrg);
    // Re-index from disk but preserve runtime stats (accessCount, lastAccessed)
    // accumulated since the last scan. Applies to personal AND org memories — org
    // entries are now refreshed too (previously skipped via the !memIndex[key] guard,
    // which left org contentPreview/tags stale after a git pull).
    const existing = memIndex[key];
    memIndex[key] = {
      key,
      filePath,
      title: fm.title ?? path.basename(filePath, '.md'),
      tags: fm.tags ?? [],
      author: fm.author,
      sessions: fm.sessions ?? [],
      created: fm.created ?? new Date().toISOString(),
      updated: fm.updated ?? new Date().toISOString(),
      importanceScore: fm.importanceScore ?? 0.5,
      category: isOrg ? 'org' : deriveCategory(filePath, isOrg),
      contentPreview: content.trim().slice(0, 500),
      accessCount: existing?.accessCount ?? 0,
      lastAccessed: existing?.lastAccessed ?? new Date().toISOString(),
      tokenEstimate: tokenEstimate(raw),
      isOrg,
    };
  } catch (e: any) {
    errors.push({ time: new Date().toISOString(), msg: `indexFile ${filePath}: ${e.message}` });
  }
}

export function deriveCategory(filePath: string, isOrg: boolean): string {
  const base = isOrg ? ORG_VAULT : PERSONAL_VAULT;
  const rel = path.relative(base, filePath);
  const parts = rel.split(path.sep);
  return parts.length > 1 ? parts[0] : 'knowledge';
}