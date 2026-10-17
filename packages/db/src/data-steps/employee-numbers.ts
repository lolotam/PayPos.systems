import { firstFreeEmployeeNumber } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import type postgres from 'postgres';

import type { Database } from '../client.ts';
import type { Tx } from '../with-tenant.ts';

/**
 * رفض ثابت النص لدور ترحيل بلا تجاوز للعزل: لا يحمل رابطاً ولا باسورد ولا بيانات.
 * بدون التجاوز، قراءة الشركات تحت FORCE RLS ترجع صفر صفوف، والخطوة كانت هتعدّي من غير ما ترقّم أحداً.
 */
export class EmployeeNumbersRoleRefusedError extends Error {
  readonly code = '42501';
  constructor() {
    super(
      'Migration data step employee-numbers needs a superuser or BYPASSRLS migration role; it would read no companies under FORCE RLS',
    );
  }
}

/**
 * رفض ثابت النص حين لا يتسع النطاق لكل موظفي شركة: يُفشل الخطوة فتبقى الـ migration معلّقة بدل أن تُسجَّل ناجحة
 * وفيها موظفون بلا رقم، ولا يحمل أي اسم أو رقم.
 */
export class EmployeeNumbersExhaustedError extends Error {
  readonly code = '23514';
  constructor() {
    super(
      'Migration data step employee-numbers could not number every employee: the 1..999999 range is full',
    );
  }
}

/** عدّادات خطوة الترقيم دون أي اسم أو رقم: الشركات والصفوف المقروءة والمرقّمة والتي لم يتسع لها النطاق. */
export interface EmployeeNumbersCounts {
  readonly companies: number;
  readonly read: number;
  readonly assigned: number;
  readonly exhausted: number;
}

/**
 * يرقّم الموظفين الذين بلا رقم وظيفي داخل كل شركة بالترتيب: تاريخ التعيين ثم وقت الإنشاء ثم المعرف، والمحذوفون
 * منطقياً داخلون (قرارا المالك EN-Q1 وEN-Q7). كل شركة تعمل داخل withTenant على pospay_app، ويقفل صف العدّاد
 * قبل أي إسناد. لا تُعاد كتابة رقم موجود، فالإعادة آمنة. العدّاد لا يتحرك للخلف ولا يتأثر برقم كُتب بالإيد.
 * الخطوة مبنية على ADR-0038؛ مالك الترحيل يقرأ معرفات الشركات فقط.
 *
 * @param owner اتصال الترحيل لاكتشاف معرفات الشركات فقط
 * @param app واجهة التطبيق المقيدة بعزل الشركات
 * @param batchSize أقصى عدد صفوف في معاملة واحدة
 * @returns أعداد الشركات والصفوف المقروءة والمرقّمة دون أسماء
 */
export async function assignEmployeeNumbers(
  owner: postgres.Sql,
  app: Database,
  batchSize = 500,
): Promise<EmployeeNumbersCounts> {
  const [role] = await owner<{ bypass: boolean }[]>`
    SELECT rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`;
  if (role?.bypass !== true) throw new EmployeeNumbersRoleRefusedError();
  const companies = await owner<{ id: string }[]>`SELECT id FROM companies ORDER BY id`;
  const counts = { companies: companies.length, read: 0, assigned: 0, exhausted: 0 };
  for (const { id: companyId } of companies) {
    for (;;) {
      const batch = await app.withTenant(companyId, async (tx) =>
        numberOneBatch(tx, companyId, batchSize),
      );
      counts.read += batch.read;
      counts.assigned += batch.assigned;
      counts.exhausted += batch.exhausted;
      if (batch.read < batchSize || batch.exhausted > 0) break;
    }
  }
  if (counts.exhausted > 0) throw new EmployeeNumbersExhaustedError();
  return counts;
}

/**
 * معاملة واحدة لدفعة واحدة: تقفل العدّاد، وتقرأ الأرقام المستخدمة من مكان العدّاد فما فوق، وترقّم الدفعة بالترتيب.
 * التحديث يكرر شرط `employee_number IS NULL` ويعدّ الصفوف التي تغيّرت فعلاً، لأن معاملة أخرى قد تكون كتبت رقماً
 * لموظف بعد قراءة الدفعة (READ COMMITTED)، ولا يجوز أن نمحوه.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة الجارية
 * @param batchSize أقصى عدد صفوف
 * @returns ما قُرئ وما رُقّم وما لم يتسع له النطاق
 */
async function numberOneBatch(tx: Tx, companyId: string, batchSize: number) {
  await tx.execute(
    sql`INSERT INTO employee_number_sequences(company_id) VALUES (${companyId}) ON CONFLICT DO NOTHING`,
  );
  const [sequence] = await tx.execute<{ next_number: number }>(
    sql`SELECT next_number FROM employee_number_sequences WHERE company_id = ${companyId} FOR UPDATE`,
  );
  const rows = await tx.execute<{ id: string }>(sql`
    SELECT id FROM employees
    WHERE company_id = ${companyId} AND employee_number IS NULL
    ORDER BY hire_date, created_at, id LIMIT ${batchSize}`);
  if (rows.length === 0 || sequence === undefined)
    return { read: rows.length, assigned: 0, exhausted: 0 };
  const startAt = sequence.next_number;
  const used = new Set(
    (
      await tx.execute<{ employee_number: number }>(sql`
      SELECT employee_number FROM employees
      WHERE company_id = ${companyId} AND employee_number >= ${startAt}`)
    ).map((row) => row.employee_number),
  );
  let counter = startAt;
  let exhausted = 0;
  const assignments: { id: string; n: number }[] = [];
  for (const [index, row] of rows.entries()) {
    const number = firstFreeEmployeeNumber(counter, used);
    if (number === null) {
      exhausted = rows.length - index;
      break;
    }
    assignments.push({ id: row.id, n: number });
    used.add(number);
    counter = number + 1;
  }
  const updated =
    assignments.length === 0
      ? []
      : await tx.execute<{ id: string }>(sql`
      UPDATE employees e SET employee_number = v.n
      FROM jsonb_to_recordset(${JSON.stringify(assignments)}::jsonb) AS v(id uuid, n integer)
      WHERE e.company_id = ${companyId} AND e.id = v.id AND e.employee_number IS NULL
      RETURNING e.id`);
  const assigned = updated.length;
  await tx.execute(
    sql`UPDATE employee_number_sequences SET next_number = GREATEST(next_number, ${Math.min(counter, 1_000_000)}), updated_at = now() WHERE company_id = ${companyId}`,
  );
  return { read: rows.length, assigned, exhausted };
}
