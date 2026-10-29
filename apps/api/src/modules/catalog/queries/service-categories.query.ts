import {
  serviceCategoryCursorData,
  serviceCategoryListItem,
  serviceCategoryPage,
  type ServiceCategoryListItem,
  type ServiceCategoryListQuery,
  type ServiceCategoryPage,
} from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export type ServiceCategoryListRow = {
  readonly id: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly visibility: 'BUSINESS' | 'BRANCH';
  readonly owner_branch_id: string | null;
  readonly closed_at: string | null;
  readonly revision: number;
  readonly category_key: string;
};

function statusClause(status: 'open' | 'closed' | 'all') {
  if (status === 'open') return sql`AND closed_at IS NULL`;
  if (status === 'closed') return sql`AND closed_at IS NOT NULL`;
  return sql``;
}

function decodeCursor(cursor: string): { key: string; id: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(cursor);
  } catch {
    throw new RangeError('SERVICE_CATEGORY_CURSOR_INVALID');
  }
  const parsed = serviceCategoryCursorData.safeParse(raw);
  if (!parsed.success) throw new RangeError('SERVICE_CATEGORY_CURSOR_INVALID');
  return { key: parsed.data[0], id: parsed.data[1] };
}

function cursorClause(cursor: string | undefined) {
  if (cursor === undefined) return sql``;
  const { key, id } = decodeCursor(cursor);
  return sql`AND (lower(name_en), id) > (${key}, ${id}::uuid)`;
}

function encodeCursor(row: ServiceCategoryListRow): string {
  return JSON.stringify([row.category_key, row.id]);
}

/** شاشة قائمة التصنيفات تقرأ كل النشاطات بالترتيب، والفهرس الفريد على المفتاح هو ترتيب القراءة. */
export function listServiceCategoriesStatement(
  companyId: string,
  businessId: string,
  query: ServiceCategoryListQuery,
) {
  return sql`SELECT id,name_en,name_ar,visibility,owner_branch_id,
      to_char(closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS closed_at,
      revision,lower(name_en) AS category_key
    FROM service_categories WHERE company_id=${companyId} AND business_id=${businessId}
    ${statusClause(query.status)}
    ${cursorClause(query.cursor)}
    ORDER BY lower(name_en) LIMIT ${query.limit + 1}`;
}

/** إسقاط صف واحد في شكل بند القائمة المتفق عليه مع العقد. */
export function toServiceCategoryListItem(row: ServiceCategoryListRow): ServiceCategoryListItem {
  return serviceCategoryListItem.parse({
    id: row.id,
    name_en: row.name_en,
    name_ar: row.name_ar,
    visibility: row.visibility,
    owner_branch_id: row.owner_branch_id,
    closed_at: row.closed_at,
    revision: row.revision,
  });
}

export async function listServiceCategories(
  tx: Tx,
  companyId: string,
  businessId: string,
  query: ServiceCategoryListQuery,
): Promise<ServiceCategoryPage> {
  const rows = await tx.execute<ServiceCategoryListRow>(
    listServiceCategoriesStatement(companyId, businessId, query),
  );
  const items = rows.slice(0, query.limit).map(toServiceCategoryListItem);
  const last = rows[query.limit - 1];
  return serviceCategoryPage.parse({
    items,
    next_cursor:
      rows.length > query.limit && last !== undefined ? encodeCursor(last) : null,
  });
}
