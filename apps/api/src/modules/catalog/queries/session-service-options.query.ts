import { sessionServiceOptionPage, type SessionServiceOptionPage, type SessionServiceOptionsQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { normalizeSearch } from '../../../shared/name-options-search.ts';
interface CursorCodec {
  decode(query: SessionServiceOptionsQuery, normalizedQ: string, scopeHash: string): { key: string; id: string } | null;
  encode(key: string, id: string, query: SessionServiceOptionsQuery, normalizedQ: string, scopeHash: string): string;
}

// نموذج تسجيل الجلسة يحتاج أسماء الخدمات وسعر القائمة ونسختها فقط، بترتيب الاسم المعروض ثم المعرّف.
export function sessionServiceOptionsStatement(companyId: string, businessId: string, query: SessionServiceOptionsQuery,
  cursor: { key: string; id: string } | null) {
  const name = query.lang === 'ar' ? sql`coalesce(name_ar,name_en) COLLATE "und-x-icu"`
    : sql`coalesce(name_en,name_ar) COLLATE "und-x-icu"`;
  const escapedQ = query.q?.trim().replace(/[\\%_]/g, '\\$&');
  return sql`SELECT id,name_ar,name_en,price,revision,${name} AS sort_key FROM services
    WHERE company_id=${companyId} AND business_id=${businessId}
    ${cursor === null ? sql`` : sql`AND (${name},id)>(${cursor.key}::text COLLATE "und-x-icu",${cursor.id}::uuid)`}
    ${escapedQ === undefined ? sql`` : sql`AND (lower(name_ar COLLATE "und-x-icu") LIKE '%' || lower(${escapedQ}::text COLLATE "und-x-icu") || '%' ESCAPE ${'\\'}
      OR lower(name_en COLLATE "und-x-icu") LIKE '%' || lower(${escapedQ}::text COLLATE "und-x-icu") || '%' ESCAPE ${'\\'})`}
    ORDER BY ${name},id LIMIT ${query.limit + 1}`;
}
export async function sessionServiceOptionsPage(tx: Tx, companyId: string, businessId: string,
  query: SessionServiceOptionsQuery, codec: CursorCodec, scopeHash: string): Promise<SessionServiceOptionPage> {
  const normalizedQ = await normalizeSearch(tx, query);
  const rows = await tx.execute<{ id: string; name_ar: string | null; name_en: string; price: string; revision: number; sort_key: string }>(
    sessionServiceOptionsStatement(companyId, businessId, query, codec.decode(query, normalizedQ, scopeHash)));
  const items = rows.slice(0, query.limit).map((r) => ({ id: r.id, name_ar: r.name_ar, name_en: r.name_en, price: r.price, revision: r.revision }));
  const last = rows[items.length - 1];
  return sessionServiceOptionPage.parse({ items, next_cursor: rows.length > query.limit && last !== undefined
    ? codec.encode(last.sort_key, last.id, query, normalizedQ, scopeHash) : null });
}
