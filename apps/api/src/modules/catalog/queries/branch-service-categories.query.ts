import {
  serviceCategoryBranchListItem,
  serviceCategoryBranchPage,
  serviceCategoryCursorData,
  type ServiceCategoryBranchListItem,
  type ServiceCategoryBranchListQuery,
  type ServiceCategoryBranchPage,
  type ServiceCategoryBranchSettingState,
  type ServiceCategoryBranchView,
} from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export type BranchServiceCategoryListRow = {
  readonly id: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly visibility: 'BUSINESS' | 'BRANCH';
  readonly owner_branch_id: string | null;
  readonly closed_at: string | null;
  readonly revision: number;
  readonly setting_state: ServiceCategoryBranchSettingState | null;
  readonly setting_revision: number | null;
  readonly category_key: string;
};

function viewClause(view: ServiceCategoryBranchView, branchId: string) {
  if (view === 'available')
    return sql`AND c.closed_at IS NULL AND
      (s.state = 'HIDDEN' OR (c.visibility = 'BRANCH' AND c.owner_branch_id <> ${branchId}))`;
  return sql`AND c.closed_at IS NULL AND coalesce(s.state, '') <> 'HIDDEN' AND
    (c.visibility = 'BUSINESS' OR c.owner_branch_id = ${branchId} OR s.state = 'ENABLED')`;
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
  return sql`AND (lower(c.name_en), c.id) > (${key}, ${id}::uuid)`;
}

/** شاشة تصنيفات الفرع تقرأ المستخدم أو المتاح للتفعيل، وتجلب إعداد الفرع بمفتاحه الفريد. */
export function listBranchServiceCategoriesStatement(
  companyId: string,
  businessId: string,
  branchId: string,
  query: ServiceCategoryBranchListQuery,
) {
  return sql`SELECT c.id,c.name_en,c.name_ar,c.visibility,c.owner_branch_id,
      to_char(c.closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS closed_at,
      c.revision,s.state AS setting_state,s.revision AS setting_revision,
      lower(c.name_en) AS category_key
    FROM service_categories c
    LEFT JOIN service_category_branch_settings s
      ON s.company_id = c.company_id AND s.branch_id = ${branchId} AND s.category_id = c.id
    WHERE c.company_id = ${companyId} AND c.business_id = ${businessId}
    ${viewClause(query.view, branchId)}
    ${cursorClause(query.cursor)}
    ORDER BY lower(c.name_en),c.id LIMIT ${query.limit + 1}`;
}

async function branchBusiness(
  tx: Tx,
  companyId: string,
  branchId: string,
): Promise<string | null> {
  const [row] = await tx.execute<{ business_id: string }>(sql`
    SELECT business_id FROM branches WHERE company_id = ${companyId} AND id = ${branchId}`);
  return row?.business_id ?? null;
}

function toItem(row: BranchServiceCategoryListRow): ServiceCategoryBranchListItem {
  return serviceCategoryBranchListItem.parse({
    id: row.id,
    name_en: row.name_en,
    name_ar: row.name_ar,
    visibility: row.visibility,
    owner_branch_id: row.owner_branch_id,
    closed_at: row.closed_at,
    revision: row.revision,
    setting_state: row.setting_state,
    setting_revision: row.setting_revision,
  });
}

export async function listBranchServiceCategories(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
  query: ServiceCategoryBranchListQuery,
): Promise<ServiceCategoryBranchPage> {
  const branchBusinessId = await branchBusiness(tx, companyId, branchId);
  if (branchBusinessId === null || branchBusinessId !== businessId)
    throw new RangeError('SERVICE_CATEGORY_NOT_FOUND');
  const rows = await tx.execute<BranchServiceCategoryListRow>(
    listBranchServiceCategoriesStatement(companyId, businessId, branchId, query),
  );
  const items = rows.slice(0, query.limit).map(toItem);
  const last = rows[query.limit - 1];
  return serviceCategoryBranchPage.parse({
    items,
    next_cursor:
      rows.length > query.limit && last !== undefined
        ? JSON.stringify([last.category_key, last.id])
        : null,
  });
}
