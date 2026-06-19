/**
 * Reciprocal Rank Fusion — merges TF-IDF and vector search result lists.
 * score(d) = Σ 1/(k + rank(d))  where k=60
 */
export function reciprocalRankFusion(
  lists: Array<Array<{ key: string; score: number }>>,
  k = 60
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    const sorted = [...list].sort((a, b) => b.score - a.score);
    sorted.forEach((item, idx) => {
      scores.set(item.key, (scores.get(item.key) ?? 0) + 1 / (k + idx + 1));
    });
  }
  return scores;
}
