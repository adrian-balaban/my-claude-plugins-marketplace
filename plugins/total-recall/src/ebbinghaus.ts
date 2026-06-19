/**
 * Ebbinghaus forgetting curve decay model.
 * strength = min(1, importance × exp(-λ × daysSince) × (1 + accessCount × 0.2))
 * where λ = 0.16 × (1 − importance × 0.8)
 */
export function computeRetentionStrength(
  importance: number,
  daysSince: number,
  accessCount: number
): number {
  const lambda = 0.16 * (1 - importance * 0.8);
  const strength = importance * Math.exp(-lambda * daysSince) * (1 + accessCount * 0.2);
  return Math.min(1, strength);
}

export function daysSince(date: string | Date): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return 0;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
}
