import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// هروب % و _ وطي ICU مشترك حتى لا تفترق خانة قائمة الموظفين عن منتقي الاستقبال.
export function icuNameMatch(q: string) {
  const escaped = q.trim().replace(/[\\%_]/g, '\\$&');
  return sql`(lower(e.name_ar COLLATE "und-x-icu") LIKE '%' || lower(${escaped}::text COLLATE "und-x-icu") || '%' ESCAPE ${'\\'}
    OR lower(e.name_en COLLATE "und-x-icu") LIKE '%' || lower(${escaped}::text COLLATE "und-x-icu") || '%' ESCAPE ${'\\'})`;
}

// ربط مؤشر البحث يستخدم طي PostgreSQL نفسه حتى تظل صفحات الأسماء غير اللاتينية متطابقة.
export async function normalizeSearch(tx: Tx, query: { q?: string | undefined }) {
  if (query.q === undefined) return '';
  const [row] = await tx.execute<{ normalized_q: string }>(sql`SELECT lower(${query.q.trim()}::text COLLATE "und-x-icu") AS normalized_q`);
  if (row === undefined) throw new Error('Name search normalization missing');
  return row.normalized_q;
}
