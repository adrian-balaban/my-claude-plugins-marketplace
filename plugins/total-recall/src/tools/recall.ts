import * as fs from 'fs';
import { parseFrontmatter } from '../frontmatter.js';
import { VECTORS_DB } from '../paths.js';
import { tfidfSearch } from '../tfidf.js';
import { parseRelativeDate } from '../dates.js';
import { memIndex } from '../state.js';
import { contentCache } from '../lru-cache.js';
import { scheduleSave } from '../persistence.js';
import { embed, isVectorAvailable } from '../embeddings.js';
import { searchVector } from '../vectorStore.js';
import { reciprocalRankFusion } from '../rrf.js';

export async function recallMemory(args: any): Promise<any> {
  const { query, full = false, since, limit = 10, excludeJournal = true, hybrid = true } = args;
  const tfidfResults = tfidfSearch(query, excludeJournal);

  // Optional hybrid path: fuse the TF-IDF rank (already decay-weighted by Ebbinghaus
  // inside tfidfSearch) with vector nearest-neighbour rank via Reciprocal Rank Fusion.
  // Falls back to TF-IDF only when embeddings are unavailable or the query fails to embed.
  let ranked: Array<{ key: string; score: number }>;
  if (hybrid && isVectorAvailable()) {
    try {
      const qvec = await embed(query);
      if (qvec) {
        const vecResults = await searchVector(VECTORS_DB, qvec, 50);
        const fused = reciprocalRankFusion([tfidfResults, vecResults]);
        ranked = [...fused.entries()].map(([key, score]) => ({ key, score }));
      } else {
        ranked = tfidfResults;
      }
    } catch {
      ranked = tfidfResults;
    }
  } else {
    ranked = tfidfResults;
  }

  if (since) {
    const cutoff = parseRelativeDate(since) ?? new Date(since);
    ranked = ranked.filter(r => {
      const updated = memIndex[r.key]?.updated;
      return updated ? new Date(updated) >= cutoff : false;
    });
  }

  ranked = ranked.slice(0, limit);

  return ranked.map(r => {
    const meta = memIndex[r.key];
    if (!meta) return null;
    meta.accessCount++;
    meta.lastAccessed = new Date().toISOString();
    scheduleSave();
    if (full) {
      let content = contentCache.get(r.key);
      if (!content) {
        try {
          const raw = fs.readFileSync(meta.filePath, 'utf8');
          content = parseFrontmatter(raw).content; // strip YAML frontmatter
        } catch { content = ''; }
        contentCache.set(r.key, content!);
      }
      return { ...meta, content, score: r.score };
    }
    return { ...meta, score: r.score };
  }).filter(Boolean);
}

export function searchIndex(args: any): any {
  const { query, limit = 20, since, category, tags: filterTags } = args;
  let results = tfidfSearch(query);

  if (since) {
    const cutoff = parseRelativeDate(since) ?? new Date(since);
    results = results.filter(r => {
      const updated = memIndex[r.key]?.updated;
      return updated ? new Date(updated) >= cutoff : false;
    });
  }
  if (category) results = results.filter(r => memIndex[r.key]?.category === category);
  if (filterTags?.length) results = results.filter(r => filterTags.every((t: string) => memIndex[r.key]?.tags.includes(t)));

  return results.slice(0, limit).map(r => {
    const m = memIndex[r.key];
    return m
      ? { key: r.key, title: m.title, category: m.category, tags: m.tags, updated: m.updated, score: r.score, preview: m.contentPreview, estimatedTokens: m.tokenEstimate }
      : null;
  }).filter(Boolean);
}