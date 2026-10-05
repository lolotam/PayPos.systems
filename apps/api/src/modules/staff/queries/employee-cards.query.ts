import { employeeCardsView, type EmployeeCardsView } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** التوكن الذي يربط قارئ وصول كارت الموظف في وحدة staff. */
export const EMPLOYEE_CARD_ACCESS = Symbol('EMPLOYEE_CARD_ACCESS');

/** قرار إدارة الموظفين من الهوية، مقروءاً أو مقفولاً حسب مسار الكتابة. */
export interface EmployeeCardAccess {
  /** يقرأ سلطة إدارة الموظفين وحالة ميزة الموارد البشرية. */
  read(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<{ manage: boolean; featureEnabled: boolean }>;
  /** يقفل السلطة قبل كتابة إصدار أو إلغاء كارت. */
  lock(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<{ manage: boolean; featureEnabled: boolean }>;
}

// شاشة كارت الموظف: الكارت النشط ولاحقته، والقدرة على الإدارة؛ لا يُعاد الكود الكامل.
export async function readEmployeeCards(
  tx: Tx,
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
  access: EmployeeCardAccess,
): Promise<EmployeeCardsView | 'FEATURE_DISABLED'> {
  const decision = await access.read(tx, companyId, userId, businessId);
  if (!decision.featureEnabled) return 'FEATURE_DISABLED';
  if (!decision.manage) return employeeCardsView.parse({ active: null, can_manage: false });
  const [row] = await tx.execute<{
    id: string;
    employee_id: string;
    card_code_suffix: string;
    issued_at: Date;
    revoked_at: Date | null;
  }>(sql`
    SELECT id,employee_id,card_code_suffix,issued_at,revoked_at FROM employee_cards
    WHERE company_id=${companyId} AND business_id=${businessId} AND employee_id=${employeeId} AND revoked_at IS NULL`);
  return employeeCardsView.parse({
    active:
      row === undefined
        ? null
        : {
            id: row.id,
            employee_id: row.employee_id,
            card_code_suffix: row.card_code_suffix,
            issued_at: new Date(row.issued_at).toISOString(),
            revoked_at: row.revoked_at === null ? null : new Date(row.revoked_at).toISOString(),
          },
    can_manage: true,
  });
}
