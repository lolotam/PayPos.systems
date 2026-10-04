import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { PasskeyBindingStatus } from '@pospay/contracts';

export const bindingStatusStatement = (companyId: string, employeeId: string) => sql`
  SELECT id AS binding_id,revision,to_char(bound_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS bound_at
  FROM employee_passkeys WHERE company_id=${companyId} AND employee_id=${employeeId} AND unbound_at IS NULL LIMIT 1`;

export async function bindingStatus(
  tx: Tx,
  companyId: string,
  employeeId: string,
): Promise<PasskeyBindingStatus> {
  const [row] = await tx.execute<{ binding_id: string; revision: number; bound_at: string }>(
    bindingStatusStatement(companyId, employeeId),
  );
  return row === undefined
    ? { bound: false, binding_id: null, revision: null, bound_at: null }
    : { bound: true, ...row };
}
