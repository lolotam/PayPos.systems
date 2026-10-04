import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';
import { readFeatureEnabled } from './feature-reader.ts';

/**
 * يثبت ترتيب أقفال محرر الصلاحيات (الشركة ثم العضويات المرتبة) قبل قفل الموظف أو النوع،
 * حتى لا يكمل تسجيل وثيقة بعد سحب الإذن أثناء الانتظار.
 *
 * @param tx معاملة كتابة الوثيقة أو النوع
 * @param companyId الشركة المتحقق منها
 * @returns وجود الشركة النشطة بعد القفل
 */
export async function lockDocumentAccess(tx: Tx, companyId: string): Promise<boolean> {
  const rows = await tx.execute(
    sql`SELECT id FROM companies WHERE id=${companyId} AND deleted_at IS NULL FOR NO KEY UPDATE`,
  );
  if (rows.length !== 1) return false;
  await tx.execute(
    sql`SELECT id FROM memberships WHERE company_id=${companyId} ORDER BY id FOR SHARE`,
  );
  return true;
}

/**
 * يقيم صلاحيات الوثائق الحية: قراءة ورفع ملفات النشاط عند نشاط الموظف المحفوظ كما يقيمها files،
 * وإدارة أنواع الشركة؛ الميزة تُقرأ فقط لمن يملك شيئاً منها حتى لا تكشف حالة الشركة.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة المتحقق منها
 * @param userId المستخدم من الجلسة
 * @param businessId نشاط الموظف أو null لأوامر الأنواع
 * @returns القراءة والإدارة وإدارة الأنواع وحالة ميزة الموظفين
 */
export async function readDocumentAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string | null,
) {
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined)
    return { read: false, manage: false, manageTypes: false, featureEnabled: false };
  const access = await readAccessTransaction(tx, companyId, userId, new Date(time.at));
  const atBusiness = (permission: string) =>
    businessId !== null && evaluateAccess(access.grants, permission, { companyId, businessId });
  const read = atBusiness('read:files:business');
  const manageTypes = evaluateAccess(access.grants, 'manage:document-types:company', { companyId });
  return {
    read,
    // الرفع بلا قراءة يسجل وثيقة لا يستطيع صاحبها فتحها؛ files يشترط الاثنين أيضاً.
    manage: read && atBusiness('manage:files:business'),
    manageTypes,
    featureEnabled: (read || manageTypes) && (await readFeatureEnabled(tx, companyId, 'staff')),
  };
}
