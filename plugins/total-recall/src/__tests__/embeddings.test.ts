import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Success path: pipeline loads and returns embeddings ─────────────────────

describe('embeddings — success path', () => {
  beforeEach(() => vi.resetModules());

  it('returns a float array when pipeline loads and runs successfully', async () => {
    vi.doMock('@huggingface/transformers', () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockResolvedValue({ data: new Float32Array(384).fill(0.1) })
      ),
    }));
    const { embed } = await import('../embeddings.js');
    const res = await embed('hello world');
    expect(Array.isArray(res)).toBe(true);
    expect(res!.length).toBe(384);
  });

  it('returns same array length on repeated calls (cached pipeline)', async () => {
    vi.doMock('@huggingface/transformers', () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockResolvedValue({ data: new Float32Array(384).fill(0.5) })
      ),
    }));
    const { embed } = await import('../embeddings.js');
    const r1 = await embed('first');
    const r2 = await embed('second');
    expect(r1!.length).toBe(r2!.length);
  });

  it('isVectorAvailable returns true when pipeline loaded', async () => {
    vi.doMock('@huggingface/transformers', () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockResolvedValue({ data: new Float32Array(384).fill(0.1) })
      ),
    }));
    const { embed, isVectorAvailable } = await import('../embeddings.js');
    await embed('probe');
    expect(isVectorAvailable()).toBe(true);
  });
});

// ─── Failure path: import succeeds but pipeline() call throws ────────────────

describe('embeddings — pipeline() call fails (catch path)', () => {
  beforeEach(() => vi.resetModules());

  it('returns null when hfPipeline() rejects (covers catch → pipeline = null)', async () => {
    vi.doMock('@huggingface/transformers', () => ({
      pipeline: vi.fn().mockRejectedValue(new Error('model load failed')),
    }));
    const { embed } = await import('../embeddings.js');
    const res = await embed('text');
    expect(res).toBeNull();
  });

  it('isVectorAvailable returns false after failed pipeline call', async () => {
    vi.doMock('@huggingface/transformers', () => ({
      pipeline: vi.fn().mockRejectedValue(new Error('model load failed')),
    }));
    const { embed, isVectorAvailable } = await import('../embeddings.js');
    await embed('probe');
    expect(isVectorAvailable()).toBe(false);
  });
});

// ─── Failure path: module import itself fails ─────────────────────────────────

describe('embeddings — module not installed (import throws)', () => {
  beforeEach(() => vi.resetModules());

  it('returns null when @huggingface/transformers is not installed', async () => {
    vi.doMock('@huggingface/transformers', () => { throw new Error('Cannot find module'); });
    const { embed } = await import('../embeddings.js');
    expect(await embed('text')).toBeNull();
  });

  it('returns null on second call (cached null pipeline)', async () => {
    vi.doMock('@huggingface/transformers', () => { throw new Error('Cannot find module'); });
    const { embed } = await import('../embeddings.js');
    await embed('first');
    expect(await embed('second')).toBeNull();
  });
});
