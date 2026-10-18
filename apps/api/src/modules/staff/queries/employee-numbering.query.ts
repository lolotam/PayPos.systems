import { employeeNumbering, type EmployeeNumbering } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

type NumberingRow = {
  next_number: number | string | null;
  start_number: number | string | null;
  start_set_at: Date | string | null;
};

export function employeeNumberingStatement(companyId: string) {
  // شاشة بداية الترقيم على مستوى الشركة.
  return sql`SELECT s.next_number, s.start_number, s.start_set_at
    FROM companies c
    LEFT JOIN employee_number_sequences s ON s.company_id = c.id
    WHERE c.id=${companyId} AND c.deleted_at IS NULL`;
}

export async function readEmployeeNumbering(
  tx: Tx,
  companyId: string,
): Promise<EmployeeNumbering | null> {
  const [row] = await tx.execute<NumberingRow>(employeeNumberingStatement(companyId));
  if (row === undefined) return null;
  if (row.next_number === null) return unsetNumbering();
  const startNumber = storedNumber(row.start_number);
  return employeeNumbering.parse({
    next_number: Number(row.next_number),
    start_number: startNumber,
    start_set_at: instant(row.start_set_at),
    can_manage: startNumber === null,
  });
}

function unsetNumbering(): EmployeeNumbering {
  // شركة نشطة بلا صف عدّاد تُعرض بالبداية 1، والحوار ما زال معروضاً لأن البداية لم تُضبط.
  return employeeNumbering.parse({
    next_number: 1,
    start_number: null,
    start_set_at: null,
    can_manage: true,
  });
}

function storedNumber(value: number | string | null): number | null {
  if (value === null) return null;
  return typeof value === 'number' ? value : Number(value);
}

function instant(value: Date | string | null): string | null {
  if (value === null) return null;
  return new Date(value).toISOString();
}
