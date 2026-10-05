import { employeeCardsView, type EmployeeCardsView } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// شاشة كارت الموظف: الكارت النشط ولاحقته، والقدرة على الإدارة؛ لا يُعاد الكود الكامل.
export async function readEmployeeCards(
  tx: Tx,
  companyId: string,
  businessId: string,
  employeeId: string,
  decision: { manage: boolean; featureEnabled: boolean },
): Promise<EmployeeCardsView | 'FEATURE_DISABLED'> {
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
