import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseFrontmatter, stringifyFrontmatter } from '../frontmatter.js';
import { ORG_VAULT, PERSONAL_VAULT, VECTORS_DB, ensureDir } from '../paths.js';
import { slugify, keyFromPath, tokenEstimate } from '../vault-scan.js';
import { memIndex } from '../state.js';
import { contentCache } from '../lru-cache.js';
import { appendJournal } from '../journal.js';
import { scheduleSave } from '../persistence.js';
import { embed } from '../embeddings.js';
import { upsertVector } from '../vectorStore.js';
import type { MemoryFrontmatter } from '../types.js';

// ─── MCP Tools implementation ─────────────────────────────────────────────────

export function storeMemory(args: any): any {
  const { title, content, tags = [], category = 'knowledge', importanceScore = 0.5, sessionId, author, force = false } = args;
  const isOrg = tags.includes('org');
  const isPersonal = tags.includes('personal');
  if (isOrg && isPersonal) throw new Error("Memory cannot have both 'org' and 'personal' tags.");

  const slug = slugify(title);
  const catDir = isOrg
    ? path.join(ORG_VAULT, category)
    : path.join(PERSONAL_VAULT, category);
  ensureDir(catDir);
  const filePath = path.join(catDir, `${slug}.md`);
  const key = keyFromPath(filePath, isOrg);
  const effectiveAuthor = author ?? os.userInfo().username;

  let preservedCreated: string | undefined;
  if (fs.existsSync(filePath)) {
    const existingFm = parseFrontmatter(fs.readFileSync(filePath, 'utf8')).data as Partial<MemoryFrontmatter>;
    // Org memories are author-protected regardless of force.
    if (isOrg && existingFm.author && existingFm.author !== effectiveAuthor) {
      throw new Error(`Cannot overwrite org memory authored by ${existingFm.author}.`);
    }
    if (!force) {
      throw new Error(
        `Memory "${key}" already exists (created ${existingFm.created ?? 'unknown'}). ` +
        `Use update_memory to modify it, or pass force=true to overwrite.`
      );
    }
    preservedCreated = existingFm.created;
  }

  const now = new Date().toISOString();
  const fm: MemoryFrontmatter = {
    title, tags,
    author: effectiveAuthor,
    sessions: sessionId ? [sessionId] : [],
    created: preservedCreated ?? now,
    updated: now,
    importanceScore,
  };

  const fileContent = stringifyFrontmatter(`\n## Executive Summary\n\n${content}`, fm);
  fs.writeFileSync(filePath, fileContent);

  const existing = memIndex[key];
  memIndex[key] = {
    key, filePath, title, tags, author: fm.author, sessions: fm.sessions,
    created: fm.created, updated: now, importanceScore, category,
    contentPreview: content.slice(0, 500),
    accessCount: existing?.accessCount ?? 0,
    lastAccessed: existing?.lastAccessed ?? now,
    tokenEstimate: tokenEstimate(fileContent), isOrg,
  };
  contentCache.set(key, content);

  if (!isOrg) appendJournal('store', key, title);
  scheduleSave();

  embed(content).then(vec => {
    if (vec) upsertVector(VECTORS_DB, key, vec);
  }).catch(() => {});

  return { key, filePath, message: `Memory stored: ${key}` };
}