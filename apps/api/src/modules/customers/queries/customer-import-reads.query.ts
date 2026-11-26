import type { CustomerImportRowsPage, CustomerImportStatus } from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { ApiError } from '../../../shared/errors.ts';

/** رمز حقن قراءة نطاق استيراد العملاء من وحدة persistence. */
export const CUSTOMER_IMPORT_SCOPE_READS = Symbol('CUSTOMER_IMPORT_SCOPE_READS');

/** قراءة نطاق الاستيراد: تحل الفرع أو النشاط إلى معرّف النشاط داخل معاملة الشركة (CI-T5). */
export interface CustomerImportScopeReads {
  business(
    tx: Tx,
    companyId: string,
    kind: 'business' | 'branch',
    id: string,
  ): Promise<string | null>;
}

export interface CustomerImportReadInput {
  readonly companyId: string;
  readonly userId: string;
  readonly scope: { readonly kind: 'business' | 'branch'; readonly id: string };
  readonly previewId: string;
}

type PageResult = {
  found: boolean;
  items: CustomerImportRowsPage['items'] | null;
  last_row_no: number | null;
  has_more: boolean;
};

/** جملة SQL لقراءة صفحة صفوف المعاينة النظيفة؛ تستعملها القراءة الإنتاجية واختبار خطة التنفيذ معاً. */
export function customerImportRowsPageStatement(input: {
  readonly companyId: string;
  readonly businessId: string;
  readonly userId: string;
  readonly previewId: string;
  readonly after: number;
  readonly limit: number;
}) {
  return sql`
    WITH preview AS (
      SELECT rows FROM import_previews
      WHERE company_id=${input.companyId} AND business_id=${input.businessId}
        AND created_by=${input.userId} AND id=${input.previewId} AND entity='customers'
    ),
    page_rows AS (
      SELECT (r.value->>'row')::int AS row_no,
             jsonb_build_object('row',(r.value->>'row')::int,'masked_phone',r.value->>'masked_phone',
               'name',r.value->>'name','locale',r.value->>'locale','status',r.value->>'status',
               'warning',r.value->>'warning') AS data
      FROM preview p, jsonb_array_elements(p.rows) AS r(value)
      WHERE (r.value->>'row')::int > ${input.after}
      ORDER BY 1 LIMIT ${input.limit + 1}
    )
    SELECT
      (SELECT EXISTS (SELECT 1 FROM preview)) AS found,
      (SELECT COALESCE(jsonb_agg(data ORDER BY row_no), '[]'::jsonb)
        FROM (SELECT row_no, data FROM page_rows ORDER BY row_no LIMIT ${input.limit}) t) AS items,
      (SELECT max(row_no) FROM (SELECT row_no FROM page_rows ORDER BY row_no LIMIT ${input.limit}) t) AS last_row_no,
      EXISTS (SELECT 1 FROM page_rows OFFSET ${input.limit}) AS has_more`;
}

/** جملة SQL لقراءة حالة المعاينة؛ تستعملها القراءة الإنتاجية واختبار خطة التنفيذ معاً. */
export function customerImportStatusStatement(input: {
  readonly companyId: string;
  readonly businessId: string;
  readonly userId: string;
  readonly previewId: string;
}) {
  return sql`SELECT id AS preview_id,status,created_count,error_code FROM import_previews
    WHERE company_id=${input.companyId} AND business_id=${input.businessId}
      AND created_by=${input.userId} AND id=${input.previewId} AND entity='customers'`;
}

/** صفوف المعاينة النظيفة بصفحة واحدة على مؤشر رقم الصف؛ الهاتف الكامل ما بيخرجش من القاعدة (CIM-06، D-10). */
export async function customerImportRowsPage(
  database: TenantWrappers,
  reads: CustomerImportScopeReads,
  input: CustomerImportReadInput & { readonly cursor: string | undefined; readonly limit: number },
): Promise<CustomerImportRowsPage> {
  const after = input.cursor === undefined ? 1 : Number(input.cursor);
  return database.withTenant(
    input.companyId,
    async (tx) => {
      const businessId = await reads.business(
        tx,
        input.companyId,
        input.scope.kind,
        input.scope.id,
      );
      if (businessId === null) throw new ApiError('IMPORT_PREVIEW_NOT_FOUND');
      const [page] = await tx.execute<PageResult>(
        customerImportRowsPageStatement({
          companyId: input.companyId,
          businessId,
          userId: input.userId,
          previewId: input.previewId,
          after,
          limit: input.limit,
        }),
      );
      if (page === undefined || !page.found) throw new ApiError('IMPORT_PREVIEW_NOT_FOUND');
      const hasMore = page.has_more && page.last_row_no !== null;
      return { items: page.items ?? [], next_cursor: hasMore ? String(page.last_row_no) : null };
    },
    { userId: input.userId },
  );
}

/** حالة المعاينة لمنشئها في نطاقها وكيان العملاء فقط (CIM-07). */
export async function customerImportStatusQuery(
  database: TenantWrappers,
  reads: CustomerImportScopeReads,
  input: CustomerImportReadInput,
): Promise<CustomerImportStatus> {
  return database.withTenant(
    input.companyId,
    async (tx) => {
      const businessId = await reads.business(
        tx,
        input.companyId,
        input.scope.kind,
        input.scope.id,
      );
      if (businessId === null) throw new ApiError('IMPORT_PREVIEW_NOT_FOUND');
      const [row] = await tx.execute<CustomerImportStatus>(
        customerImportStatusStatement({
          companyId: input.companyId,
          businessId,
          userId: input.userId,
          previewId: input.previewId,
        }),
      );
      if (row === undefined) throw new ApiError('IMPORT_PREVIEW_NOT_FOUND');
      return row;
    },
    { userId: input.userId },
  );
}
