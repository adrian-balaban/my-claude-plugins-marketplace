// ─── Types ───────────────────────────────────────────────────────────────────

export interface MemoryFrontmatter {
  title: string;
  tags: string[];
  author?: string;
  sessions?: string[];
  created: string;
  updated: string;
  importanceScore?: number;
}

export interface MemoryMetadata extends MemoryFrontmatter {
  key: string;
  filePath: string;
  category: string;
  contentPreview: string;
  accessCount: number;
  lastAccessed: string;
  tokenEstimate: number;
  importanceScore: number;
  isOrg: boolean;
}

export type Index = Record<string, MemoryMetadata>;
export type InvertedIndex = Record<string, { docs: string[]; idf: number }>;