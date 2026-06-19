import type { Index, InvertedIndex } from './types.js';

// ─── In-memory state (shared singletons) ─────────────────────────────────────
// Every module imports these from here so there is exactly one memIndex /
// invertedIndex across the process. They are `const` objects with a stable
// identity: callers mutate in place (`memIndex[key] = …`, `delete memIndex[key]`)
// and the two sites that formerly reassigned them (loadIndexes,
// rebuildInvertedIndex) now clear-then-populate the same object. This preserves
// the single-source-of-truth invariant the test suite depends on (it re-imports
// the live module and resets via rebuild_index).

export const memIndex: Index = {};
export const invertedIndex: InvertedIndex = {};
export const errors: Array<{ time: string; msg: string }> = [];
export const perfSamples: number[] = [];