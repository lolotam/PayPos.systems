import { computeStatementPayable, type StatementRow } from '@pospay/commissions-engine';

import type { EmployeeCarryBalance } from '../../domain/approval-plan.ts';

/**
 * يجمّع صفوف الكشف المجمّدة لكل موظفة ويطلب من محرك العمولات مستحقها بنفس دالة المستحق التي يراها المراجع، فيعيد ما يُرحَّل
 * من جانبي العمولة والبقشيش. صف EMPLOYEE (صفر) لا يدخل الحساب. الموظفات بترتيب أول ظهور لا يهم لأن قاعدة الترحيل ترتّبهن.
 *
 * @param rows صفوف الباني كلها
 * @returns رصيد كل موظفة لها صفوف
 */
export function employeeCarryBalances(rows: readonly StatementRow[]): EmployeeCarryBalance[] {
  const byEmployee = new Map<string, StatementRow[]>();
  for (const row of rows) {
    if (row.kind === 'EMPLOYEE') continue;
    const list = byEmployee.get(row.employeeId) ?? [];
    list.push(row);
    byEmployee.set(row.employeeId, list);
  }
  return [...byEmployee].map(([employeeId, employeeRows]) => {
    const payable = computeStatementPayable(employeeRows);
    return {
      employeeId,
      commissionCarryOut: payable.commissionCarryOut,
      tipCarryOut: payable.tipCarryOut,
    };
  });
}
