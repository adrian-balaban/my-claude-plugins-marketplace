import { computeRetentionStrength, daysSince } from './ebbinghaus.js';
import { memIndex, invertedIndex } from './state.js';

// ─── TF-IDF ──────────────────────────────────────────────────────────────────

export function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
}

export function rebuildInvertedIndex() {
  const docFreq: Record<string, number> = {};
  const docTokens: Record<string, string[]> = {};
  const N = Object.keys(memIndex).length;

  for (const [key, meta] of Object.entries(memIndex)) {
    const tokens = tokenize(`${meta.title} ${meta.tags.join(' ')} ${meta.contentPreview}`);
    docTokens[key] = tokens;
    const unique = new Set(tokens);
    for (const t of unique) {
      docFreq[t] = (docFreq[t] ?? 0) + 1;
    }
  }

  // Clear-then-populate the shared singleton (formerly `invertedIndex = {}`).
  for (const t of Object.keys(invertedIndex)) delete invertedIndex[t];
  for (const [key, tokens] of Object.entries(docTokens)) {
    const unique = new Set(tokens);
    for (const t of unique) {
      if (!invertedIndex[t]) invertedIndex[t] = { docs: [], idf: 0 };
      invertedIndex[t].docs.push(key);
    }
  }
  for (const t of Object.keys(invertedIndex)) {
    invertedIndex[t].idf = Math.log((N + 1) / (docFreq[t] + 1)) + 1;
  }
}

export function tfidfSearch(query: string, excludeJournal = true): Array<{ key: string; score: number }> {
  const tokens = tokenize(query);
  const scores: Record<string, number> = {};

  for (const token of tokens) {
    const entry = invertedIndex[token];
    if (!entry) continue;
    for (const key of entry.docs) {
      const meta = memIndex[key];
      if (!meta) continue;
      if (excludeJournal && meta.category === 'journal') continue;
      const tf = tokenize(`${meta.title} ${meta.contentPreview}`).filter(t => t === token).length;
      let score = tf * entry.idf;
      if (meta.title.toLowerCase().includes(token)) score *= 2;
      if (meta.tags.some(t => t.toLowerCase().includes(token))) score *= 1.5;
      const decay = computeRetentionStrength(
        meta.importanceScore,
        daysSince(meta.updated),
        meta.accessCount
      );
      scores[key] = (scores[key] ?? 0) + score * decay;
    }
  }

  return Object.entries(scores)
    .map(([key, score]) => ({ key, score }))
    .sort((a, b) => b.score - a.score);
}