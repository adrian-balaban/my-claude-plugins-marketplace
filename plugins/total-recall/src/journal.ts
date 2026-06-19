import * as fs from 'fs';
import * as path from 'path';
import { PERSONAL_VAULT, ensureDir } from './paths.js';

// ─── Journal append ──────────────────────────────────────────────────────────

export function appendJournal(action: string, key: string, title: string) {
  const today = new Date().toISOString().slice(0, 10);
  const journalPath = path.join(PERSONAL_VAULT, 'journal', `${today}.md`);
  ensureDir(path.dirname(journalPath));
  const entry = `\n- ${new Date().toISOString()} [${action}] **${title}** (\`${key}\`)\n`;
  fs.appendFileSync(journalPath, entry);
}