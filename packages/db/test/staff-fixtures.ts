import { employeeNameMatchKey } from '@pospay/domain';
import type postgres from 'postgres';

/**
 * يبني موظفاً اصطناعياً لاعتمادات الاختبارات القديمة بعد إضافة FK الموظف؛ لا ينشئ عضوية أو راتباً.
 *
 * @param owner اتصال مالك قاعدة الاختبار المستنسخة فقط
 * @param companyId شركة fixture الموجودة
 * @param employeeId معرف الموظف الذي تتطلبه الحالة
 * @returns يكتمل عند وجود مرجع صحيح في نشاط وفرع من نفس الشركة
 */
export async function seedEmployee(
  owner: postgres.Sql,
  companyId: string,
  employeeId: string,
): Promise<void> {
  await owner`INSERT INTO employees (company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    SELECT ${companyId}, ${employeeId}, business_id, id, ${`Synthetic ${employeeId}`}, ${employeeNameMatchKey(`Synthetic ${employeeId}`)}, 'staff', '2026-01-01'
    FROM branches WHERE company_id=${companyId} ORDER BY id LIMIT 1
    ON CONFLICT (company_id,id) DO NOTHING`;
}
