import type { StaffColumnCode } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { OwnWorkContext } from './own-work-context.ts';
import { instantText, uuidList } from './own-service-lines.sql.ts';

export type OwnLineDetail = {
  id: string;
  status: string;
  late?: boolean;
  name_ar?: string | null;
  name_en?: string;
  list_price?: string;
  discount?: string;
  net?: string;
};

// الأعمدة تدخل قائمة SELECT بمفتاحها المسموح فقط: عمود غير مسموح لا يُقرأ من قاعدة البيانات أصلاً.
const columnsFor = (allowed: ReadonlySet<StaffColumnCode>) => [
  sql`id`,
  sql`status`,
  ...(allowed.has('date') ? [sql`late`] : []),
  ...(allowed.has('service') ? [sql`name_ar`, sql`name_en`] : []),
  ...(allowed.has('list_price') ? [sql`list_price::text AS list_price`] : []),
  ...(allowed.has('discount') ? [sql`discount::text AS discount`] : []),
  ...(allowed.has('net') ? [sql`net::text AS net`] : []),
];

/**
 * يقرأ تفاصيل سطور الصفحة الواحدة (حتى limit+1) بأعمدتها المسموحة فقط، من جدول service_lines وحده.
 *
 * @param tx معاملة القراءة الواحدة
 * @param c سياق الشركة والنشاط
 * @param lineIds سطور الصفحة، وكلها من مجموعة الموظفة
 * @param allowed أكواد الأعمدة المسموحة للنشاط
 * @returns تفاصيل كل سطر بمعرفه
 */
export async function readLineDetails(
  tx: Tx,
  c: OwnWorkContext,
  lineIds: readonly string[],
  allowed: ReadonlySet<StaffColumnCode>,
) {
  const rows = await tx.execute<OwnLineDetail>(sql`SELECT ${sql.join(columnsFor(allowed), sql`,`)}
    FROM service_lines
    WHERE company_id=${c.companyId} AND business_id=${c.businessId} AND id=ANY(${uuidList(lineIds)})`);
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * يقرأ اسم العميل فقط (لا هاتف ولا معرف) لزيارات الصفحة، ولا يُستدعى إلا لو العمود مسموح.
 *
 * @param tx معاملة القراءة الواحدة
 * @param c سياق الشركة والنشاط
 * @param sessionIds زيارات الصفحة
 * @returns اسم العميل لكل زيارة
 */
export async function readCustomerNames(tx: Tx, c: OwnWorkContext, sessionIds: readonly string[]) {
  const rows = await tx.execute<{ id: string; customer_name: string }>(sql`SELECT id,customer_name
    FROM service_sessions
    WHERE company_id=${c.companyId} AND business_id=${c.businessId} AND id=ANY(${uuidList(sessionIds)})`);
  return new Map(rows.map((row) => [row.id, row.customer_name]));
}

/**
 * يقرأ لحظة الإلغاء للسطور الملغاة في الصفحة فقط؛ حقل سياق دائم لا يتبع إعداد الأعمدة (D-A7).
 *
 * @param tx معاملة القراءة الواحدة
 * @param c سياق الشركة والنشاط
 * @param lineIds السطور الملغاة في الصفحة
 * @returns لحظة الإلغاء بالميلي ثانية لكل سطر
 */
export async function readCancellations(tx: Tx, c: OwnWorkContext, lineIds: readonly string[]) {
  const rows = await tx.execute<{ line_id: string; cancelled_at: string }>(
    sql`SELECT line_id,${instantText('cancelled_at')} AS cancelled_at
    FROM service_line_cancellations
    WHERE company_id=${c.companyId} AND business_id=${c.businessId} AND line_id=ANY(${uuidList(lineIds)})`,
  );
  return new Map(rows.map((row) => [row.line_id, row.cancelled_at]));
}
