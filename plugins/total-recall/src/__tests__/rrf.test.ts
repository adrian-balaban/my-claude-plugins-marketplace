import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion } from '../rrf.js';

describe('reciprocalRankFusion', () => {
  it('returns empty map for empty input', () => {
    expect(reciprocalRankFusion([])).toEqual(new Map());
  });

  it('scores a single-item list: rank-0 gets 1/(k+1)', () => {
    const result = reciprocalRankFusion([[{ key: 'a', score: 10 }]]);
    expect(result.get('a')).toBeCloseTo(1 / 61);
  });

  it('lower rank = lower score within one list', () => {
    const result = reciprocalRankFusion([[{ key: 'a', score: 10 }, { key: 'b', score: 5 }]]);
    expect(result.get('a')!).toBeGreaterThan(result.get('b')!);
  });

  it('doc appearing in two lists scores higher than doc in one list', () => {
    const l1 = [{ key: 'a', score: 10 }, { key: 'b', score: 5 }];
    const l2 = [{ key: 'b', score: 8 }, { key: 'c', score: 3 }];
    const result = reciprocalRankFusion([l1, l2]);
    // b appears in both lists; a appears only in l1 (rank 0)
    // b: 1/62 + 1/61 ≈ 0.0325; a: 1/61 ≈ 0.0164
    expect(result.get('b')!).toBeGreaterThan(result.get('a')!);
  });

  it('doc top in three lists beats docs in one list each', () => {
    const l1 = [{ key: 'a', score: 3 }, { key: 'b', score: 2 }];
    const l2 = [{ key: 'a', score: 5 }, { key: 'c', score: 1 }];
    const l3 = [{ key: 'a', score: 2 }];
    const result = reciprocalRankFusion([l1, l2, l3]);
    // a: 3 * 1/61 ≈ 0.049; b: 1/62 ≈ 0.016; c: 1/62 ≈ 0.016
    const aScore = result.get('a') ?? 0;
    const bScore = result.get('b') ?? 0;
    const cScore = result.get('c') ?? 0;
    expect(aScore).toBeGreaterThan(bScore);
    expect(aScore).toBeGreaterThan(cScore);
  });

  it('custom k: smaller k gives higher score for top-ranked doc', () => {
    const list = [{ key: 'a', score: 1 }];
    expect(reciprocalRankFusion([list], 10).get('a')!).toBeGreaterThan(
      reciprocalRankFusion([list], 60).get('a')!
    );
  });

  it('does not mutate input lists', () => {
    const list = [{ key: 'a', score: 5 }, { key: 'b', score: 3 }];
    const snapshot = list.map(x => ({ ...x }));
    reciprocalRankFusion([list]);
    expect(list).toEqual(snapshot);
  });

  it('handles single-element lists correctly', () => {
    const result = reciprocalRankFusion([[{ key: 'x', score: 1 }], [{ key: 'y', score: 1 }]]);
    expect(result.get('x')).toBeCloseTo(1 / 61);
    expect(result.get('y')).toBeCloseTo(1 / 61);
  });
});
