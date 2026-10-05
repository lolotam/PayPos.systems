import { employeeDocumentsView } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export const EMPLOYEE_DOCUMENT_ACCESS = Symbol('EMPLOYEE_DOCUMENT_ACCESS');
/** قراءة الصلاحية ويوم النشاط داخل المعاملة دون ربط الاستعلام بطبقات الكتابة. */
export interface EmployeeDocumentReadAccess {
  /** يقيم قراءة ملفات النشاط ويعيد اليوم المحلي للشارة، دون كشف وجود أي وثيقة. */
  check(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<{ read: boolean; manage: boolean; featureEnabled: boolean; today: string }>;
}

// قسم الوثائق في صفحة الموظف: الحالية لكل نوع بحالة محسوبة بنفس قاعدة documentStatus،
// والأنواع المفعلة لنموذج الرفع، في استعلام واحد.
export function employeeDocumentsStatement(companyId: string, employeeId: string, today: string) {
  return sql`SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'employee_id',d.employee_id,'type_code',d.type_code,
      'type_name_en',t.name_en,'type_name_ar',t.name_ar,'object_key',d.object_key,
      'expires_on',to_char(d.expires_on,'YYYY-MM-DD'),'uploaded_by',d.uploaded_by,
      'recorded_at',to_char(d.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'status',CASE WHEN d.expires_on IS NULL THEN 'NO_EXPIRY'
        WHEN d.expires_on < ${today}::date THEN 'EXPIRED'
        WHEN d.expires_on - ${today}::date <= t.alert_days THEN 'EXPIRING'
        ELSE 'VALID' END) ORDER BY t.name_en, d.type_code)
      FROM employee_documents d
      JOIN document_types t ON t.company_id=d.company_id AND t.code=d.type_code
      WHERE d.company_id=${companyId} AND d.employee_id=${employeeId} AND d.replaced_at IS NULL),'[]'::jsonb) AS items,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'code',t.code,'name_en',t.name_en,'name_ar',t.name_ar,
      'alert_days',t.alert_days,'requires_expiry',t.requires_expiry,'active',t.active,'revision',t.revision)
      ORDER BY t.name_en, t.id)
      FROM document_types t WHERE t.company_id=${companyId} AND t.active),'[]'::jsonb) AS types`;
}

const json = (value: unknown) =>
  typeof value === 'string' ? (JSON.parse(value) as unknown) : value;

export async function employeeDocuments(
  tx: Tx,
  context: { companyId: string; userId: string; businessId: string; employeeId: string },
  access: EmployeeDocumentReadAccess,
) {
  const { companyId, businessId, employeeId, userId } = context;
  const [employee] = await tx.execute(
    sql`SELECT id FROM employees WHERE company_id=${companyId} AND business_id=${businessId} AND id=${employeeId} AND deleted_at IS NULL`,
  );
  if (employee === undefined) return null;
  const decision = await access.check(tx, companyId, userId, businessId);
  if (!decision.read) return null;
  if (!decision.featureEnabled) return 'FEATURE_DISABLED' as const;
  const [row] = await tx.execute<{ items: unknown; types: unknown }>(
    employeeDocumentsStatement(companyId, employeeId, decision.today),
  );
  return employeeDocumentsView.parse({
    today: decision.today,
    items: json(row?.items) ?? [],
    types: json(row?.types) ?? [],
    can_manage: decision.manage,
  });
}
