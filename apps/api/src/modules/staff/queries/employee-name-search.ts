import { sql } from 'drizzle-orm';

// خانة البحث في قائمة الموظفين، ومنتقي موظف الاستقبال.
export function icuNameMatch(q: string) {
  const escaped = q.trim().replace(/[\\%_]/g, '\\$&');
  return sql`(lower(e.name_ar COLLATE "und-x-icu") LIKE '%' || lower(${escaped}::text COLLATE "und-x-icu") || '%' ESCAPE ${'\\'}
    OR lower(e.name_en COLLATE "und-x-icu") LIKE '%' || lower(${escaped}::text COLLATE "und-x-icu") || '%' ESCAPE ${'\\'})`;
}
