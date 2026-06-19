// ─── Date filter helpers ──────────────────────────────────────────────────────

export function parseRelativeDate(expr: string): Date | null {
  const m = expr.match(/^(\d+)([dwm])$/);
  if (!m) return null;
  const n = parseInt(m[1]);
  const unit = m[2];
  const ms = unit === 'd' ? n * 86400000 : unit === 'w' ? n * 7 * 86400000 : n * 30 * 86400000;
  return new Date(Date.now() - ms);
}