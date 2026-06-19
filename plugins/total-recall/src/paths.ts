import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ─── Paths ───────────────────────────────────────────────────────────────────

export const HOME = os.homedir();
export const PERSONAL_VAULT = path.join(HOME, '.total-recall', 'personal');
export const ORG_VAULT = path.join(HOME, '.total-recall', 'org', 'org-vault');
export const VECTORS_DB = path.join(PERSONAL_VAULT, 'vectors.db');
export const INDEX_PATH = path.join(HOME, '.total-recall', 'index.json');
export const INVERTED_INDEX_PATH = path.join(HOME, '.total-recall', 'invertedIndex.json');
export const INDEX_CACHE_PATH = path.join(HOME, '.total-recall', '.index-cache.txt');

export const EXCLUDED_DIRS = new Set([
  'projects', 'templates', '.obsidian', 'reference-docs', 'in-progress', 'completed',
]);
export const DEFAULT_CATEGORIES = [
  'architecture', 'decisions', 'troubleshooting', 'meetings', 'knowledge', 'journal',
];

export function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}