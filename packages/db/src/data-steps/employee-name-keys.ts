import { employeeNameMatchKey } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import type postgres from 'postgres';

import type { Database } from '../client.ts';

/**
 * رفض ثابت النص لدور ترحيل بلا تجاوز للعزل: لا يحمل رابطاً ولا باسورد ولا بيانات، فيمر من التعقيم كما هو.
 * بدون التجاوز، قراءة الشركات تحت FORCE RLS ترجع صفر صفوف، والخطوة كانت هتعدّي من غير ما تصلح أي مفتاح.
 */
export class MigrationRoleRefusedError extends Error {
  readonly code = '42501';
  constructor() {
    super(
      'Migration data step employee-name-keys needs a superuser or BYPASSRLS migration role; it would read no companies under FORCE RLS',
    );
  }
}

/**
 * يعيد حساب مفاتيح الأسماء بقاعدة المجال نفسها، مع عزل الشركات وقفل كل دفعة حتى حفظها.
 * تشمل القراءة المحذوفين منطقياً، وتظل الصفوف الصحيحة دون كتابة لتكون إعادة التشغيل آمنة.
 * ترفض قبل أي قراءة لو دور الترحيل مش superuser ولا BYPASSRLS، زي حارس 0074، بدل نجاح فاضي.
 *
 * @param owner اتصال الترحيل لاكتشاف معرفات الشركات فقط
 * @param app واجهة التطبيق المقيدة بعزل الشركات
 * @param batchSize أقصى عدد صفوف في معاملة واحدة
 * @returns أعداد الشركات والصفوف المقروءة والمحدثة دون أسماء
 */
export async function rekeyEmployeeNameKeys(
  owner: postgres.Sql,
  app: Database,
  batchSize = 500,
): Promise<{ companies: number; read: number; updated: number }> {
  const [role] = await owner<{ bypass: boolean }[]>`
    SELECT rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`;
  if (role?.bypass !== true) throw new MigrationRoleRefusedError();
  const companies = await owner<{ id: string }[]>`SELECT id FROM companies ORDER BY id`;
  const counts = { companies: companies.length, read: 0, updated: 0 };
  for (const { id: companyId } of companies) {
    let cursor: string | undefined;
    for (;;) {
      const batch = await app.withTenant(companyId, async (tx) => {
        const rows = await tx.execute<{
          id: string;
          name_en: string;
          name_ar: string | null;
          name_en_key: string | null;
          name_ar_key: string | null;
        }>(sql`SELECT id, name_en, name_ar, name_en_key, name_ar_key FROM employees
          WHERE company_id = ${companyId} ${cursor === undefined ? sql`` : sql`AND id > ${cursor}`}
          ORDER BY id LIMIT ${batchSize} FOR UPDATE`);
        let updated = 0;
        for (const row of rows) {
          const en = employeeNameMatchKey(row.name_en);
          const ar = row.name_ar === null ? null : employeeNameMatchKey(row.name_ar);
          if (row.name_en_key === en && row.name_ar_key === ar) continue;
          await tx.execute(sql`UPDATE employees SET name_en_key = ${en}, name_ar_key = ${ar}
            WHERE company_id = ${companyId} AND id = ${row.id}`);
          updated++;
        }
        return { read: rows.length, updated, cursor: rows.at(-1)?.id };
      });
      counts.read += batch.read;
      counts.updated += batch.updated;
      if (batch.read < batchSize) break;
      cursor = batch.cursor;
    }
  }
  return counts;
}
