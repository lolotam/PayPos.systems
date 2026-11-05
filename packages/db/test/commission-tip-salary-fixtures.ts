import { sql } from 'drizzle-orm';
import { systemUuidV7 } from '@pospay/ids';

import type { Tx } from '../src/index.ts';
import type { CommissionTenant } from './commission-statement-fixtures.ts';

export const tipSalaryIds = systemUuidV7();
export const projectionTables = [
  'commission_tip_heads',
  'commission_tips',
  'commission_salaries',
] as const;
export type ProjectionTable = (typeof projectionTables)[number];

/** ينشئ صف إسقاط صالحًا، مع تجاوزات محدودة لاختبار قيود قاعدة البيانات. */
export function insertTipSalary(
  tx: Tx,
  table: ProjectionTable,
  tenant: CommissionTenant,
  overrides: Record<string, string | number> = {},
) {
  const row = {
    company: tenant.company,
    business: tenant.business,
    branch: tenant.branch,
    employee: tenant.employee,
    id: tipSalaryIds.newId(),
    session: tipSalaryIds.newId(),
    revision: 1,
    businessDate: '2026-11-01',
    period: '2026-11',
    effectiveFrom: '2026-11-01',
    method: 'CARD',
    amount: '12.345',
    ...overrides,
  };
  if (table === 'commission_tip_heads')
    return tx.execute(sql`
    INSERT INTO commission_tip_heads(company_id,id,business_id,session_id,branch_id,revision,business_date,period)
    VALUES(${row.company},${row.id},${row.business},${row.session},${row.branch},${row.revision},${row.businessDate},${row.period})`);
  if (table === 'commission_tips')
    return tx.execute(sql`
    INSERT INTO commission_tips(company_id,id,business_id,session_id,employee_id,method,amount)
    VALUES(${row.company},${row.id},${row.business},${row.session},${row.employee},${row.method},${row.amount})`);
  return tx.execute(sql`
    INSERT INTO commission_salaries(company_id,id,business_id,employee_id,effective_from,amount,revision)
    VALUES(${row.company},${row.id},${row.business},${row.employee},${row.effectiveFrom},${row.amount},${row.revision})`);
}
