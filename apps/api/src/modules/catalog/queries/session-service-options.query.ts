import { sessionServiceOptionPage, type SessionServiceOptionPage, type SessionServiceOptionsQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// نموذج تسجيل الجلسة يحتاج أسماء الخدمات وسعر القائمة ونسختها فقط، بترتيب المعرّف المفهرس.
export function sessionServiceOptionsStatement(companyId: string, businessId: string, query: SessionServiceOptionsQuery) {
  return sql`SELECT id,name_ar,name_en,price,revision FROM services
    WHERE company_id=${companyId} AND business_id=${businessId}
    ${query.cursor === undefined ? sql`` : sql`AND id > ${query.cursor}`}
    ORDER BY id LIMIT ${query.limit + 1}`;
}
export async function readSessionServiceOptions(tx: Tx, companyId: string, businessId: string,
  query: SessionServiceOptionsQuery): Promise<SessionServiceOptionPage> {
  const rows = await tx.execute(sessionServiceOptionsStatement(companyId, businessId, query));
  const items = rows.slice(0, query.limit);
  return sessionServiceOptionPage.parse({ items, next_cursor: rows.length > query.limit ? items.at(-1)?.['id'] : null });
}
