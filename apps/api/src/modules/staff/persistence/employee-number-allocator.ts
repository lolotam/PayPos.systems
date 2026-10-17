import { firstFreeEmployeeNumber, nextEmployeeNumberCounter } from '@pospay/domain';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { EmployeeCreationError } from '../domain/create-employee.ts';

const EMPLOYEE_NUMBER_PAGE_SIZE = 256;

// ترتيب الأقفال: الشركة، ثم العضويات بالمعرف، ثم أقفال معاينة الاستيراد ومفتاح التكرار (مسارات الاستيراد فقط)، ثم صف العدّاد، ثم صفوف الموظفين، ثم المرفقات والتدقيق.
export async function assignEmployeeNumber(tx: Tx, companyId: string): Promise<number> {
  await tx.execute(
    sql`INSERT INTO employee_number_sequences(company_id) VALUES (${companyId}) ON CONFLICT DO NOTHING`,
  );
  const [sequence] = await tx.execute<{ next_number: number }>(
    sql`SELECT next_number FROM employee_number_sequences WHERE company_id = ${companyId} FOR UPDATE`,
  );
  if (sequence === undefined) throw new Error('EMPLOYEE_PERSISTENCE_FAILED');
  const assigned = await firstUnused(tx, companyId, sequence.next_number);
  if (assigned === null) throw new EmployeeCreationError('EMPLOYEE_NUMBER_EXHAUSTED');
  await tx.execute(sql`
    UPDATE employee_number_sequences
    SET next_number = GREATEST(next_number, ${nextEmployeeNumberCounter(assigned)}), updated_at = now()
    WHERE company_id = ${companyId}`);
  return assigned;
}

async function firstUnused(tx: Tx, companyId: string, start: number): Promise<number | null> {
  let candidate = start;
  for (;;) {
    const page = await tx.execute<{ employee_number: number }>(sql`
      SELECT employee_number FROM employees
      WHERE company_id = ${companyId} AND employee_number >= ${candidate}
      ORDER BY employee_number
      LIMIT ${EMPLOYEE_NUMBER_PAGE_SIZE}`);
    const numbers = page.map((row) => row.employee_number);
    const free = firstFreeEmployeeNumber(candidate, numbers);
    if (free === null) return null;
    const last = numbers[numbers.length - 1];
    if (numbers.length < EMPLOYEE_NUMBER_PAGE_SIZE || (last !== undefined && free < last))
      return free;
    candidate = free;
  }
}
