import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { SessionError } from '../domain/session-error.ts';
import type { CancellationRedemptionRequest, CancellationRedemptionReversal, LockedCancellationRedemption } from '../ports/line-cancel.port.ts';
import { lineInScope, type LineScope } from './line-scope.ts';

export async function lockRedemptionComponent(
  tx: Tx,
  scope: LineScope,
  request: CancellationRedemptionRequest,
): Promise<LockedCancellationRedemption> {
  const { sessionId, lineId, redemptionId } = request;
  const [redemption] = await tx.execute<{ component_id: string; slot_id: string }>(sql`
    SELECT r.component_id,r.slot_id FROM package_redemptions r
    WHERE r.company_id=${scope.companyId} AND r.business_id=${scope.businessId}
      AND r.id=${redemptionId} AND r.line_id=${lineId} AND ${lineInScope(scope, sessionId, lineId)}`);
  if (redemption === undefined) throw new SessionError('PACKAGE_REDEMPTION_ALREADY_REVERSED');
  const components = await tx.execute(sql`SELECT id FROM package_components
    WHERE company_id=${scope.companyId} AND business_id=${scope.businessId}
      AND id=${redemption.component_id} FOR UPDATE`);
  if (components.length !== 1) throw new SessionError('PACKAGE_REDEMPTION_ALREADY_REVERSED');
  return { ...request, componentId: redemption.component_id, slotId: redemption.slot_id };
}

export async function reversePackageRedemption(
  tx: Tx,
  scope: LineScope,
  request: CancellationRedemptionReversal,
): Promise<void> {
  const { lineId, redemptionId, cancellationId, at, componentId, slotId } = request;
  const reversed = await tx.execute(sql`UPDATE package_redemptions
    SET reversed_at=${at.toISOString()}::timestamptz,reversal_cancellation_id=${cancellationId}
    WHERE company_id=${scope.companyId} AND business_id=${scope.businessId}
      AND id=${redemptionId} AND line_id=${lineId} AND reversed_at IS NULL RETURNING id`);
  if (reversed.length !== 1) throw new SessionError('PACKAGE_REDEMPTION_ALREADY_REVERSED');
  const freed = await tx.execute(sql`UPDATE package_session_slots SET state='FREE',current_redemption_id=NULL
    WHERE company_id=${scope.companyId} AND business_id=${scope.businessId}
      AND component_id=${componentId} AND id=${slotId}
      AND state='USED' AND current_redemption_id=${redemptionId} RETURNING id`);
  if (freed.length !== 1) throw new SessionError('PACKAGE_REDEMPTION_ALREADY_REVERSED');
}
