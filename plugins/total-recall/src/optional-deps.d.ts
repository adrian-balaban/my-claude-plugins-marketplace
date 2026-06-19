// Ambient declarations for optional native dependencies that ship no types.
// These are lazy-imported and treated as `any` (see vectorStore.ts); the build
// externalizes them, so they may be absent at runtime and degrade gracefully.
declare module 'better-sqlite3';
