import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// ربط مؤشر البحث يستخدم طي PostgreSQL نفسه حتى تظل صفحات الأسماء غير اللاتينية متطابقة.
export async function normalizeSearch(tx: Tx, query: { q?: string | undefined }) {
  if (query.q === undefined) return '';
  const [row] = await tx.execute<{ normalized_q: string }>(sql`SELECT lower(${query.q.trim()}::text COLLATE "und-x-icu") AS normalized_q`);
  if (row === undefined) throw new Error('Name search normalization missing');
  return row.normalized_q;
}
