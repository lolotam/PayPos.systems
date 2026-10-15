import { appendAuditLog, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../../shared/errors.ts';
import type { SessionRecoveryConfirm, SessionRecoveryConfirmPort } from '../ports/session-recovery-confirm.port.ts';
import { recoveryKeyHash } from './session-recovery.adapter.ts';
import { sessionRecoveryPlace, sessionRecoveryRecord } from './session-recovery-read.adapter.ts';

export function createSessionRecoveryConfirm(database: TenantWrappers): SessionRecoveryConfirmPort {
  return { confirm: (input) => database.withTenant(input.companyId, (tx) => confirmProof(tx, input), { userId: input.userId }) };
}
async function confirmProof(tx: Tx, input: SessionRecoveryConfirm): Promise<void> {
  if (!await sessionRecoveryPlace(tx, input.companyId, input.businessId, input.branchId)) throw new ApiError('FORBIDDEN');
  const access = await sessionRecoveryRecord(tx, input.companyId, input.userId, input.businessId, input.branchId, input.at);
  if (access === 'DENIED') throw new ApiError('FORBIDDEN');
  if (access === 'FEATURE_DISABLED') throw new ApiError('FEATURE_DISABLED');
  const rows = await tx.execute<{ id: string }>(sql`
    UPDATE service_session_recoveries SET revoked_at = ${input.at.toISOString()}::timestamptz, revoked_outcome = ${input.outcome}
    WHERE company_id = ${input.companyId} AND company_id = app_company_id()
      AND user_id = ${input.userId} AND user_id = app_user_id()
      AND business_id = ${input.businessId} AND branch_id = ${input.branchId}
      AND operation = ${input.operation} AND key_hash = ${recoveryKeyHash(input.key)} AND revoked_at IS NULL
    RETURNING id`);
  const id = rows[0]?.id;
  if (id === undefined) return;
  await appendAuditLog(tx, input.auditId, {
    entity: 'service_session_recovery', entityId: id, action: 'recovery.confirmed',
    before: { revoked_outcome: null }, after: { revoked_outcome: input.outcome },
  });
}
