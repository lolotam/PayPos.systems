import { markCommissionStatementPaidResponse, type MarkCommissionStatementPaidInput } from '@pospay/contracts';
import { apiClient } from '@/shared/api/client';
import { refusal } from './commission-plans-client';
import type { StatementTarget } from './statement-commands';

export async function payStatement(target: StatementTarget, key: string, body: MarkCommissionStatementPaidInput) {
  const { scope, period } = target;
  const result = await apiClient().POST('/v1/businesses/{businessId}/commission-statements/{period}/mark-paid', {
    params: {
      header: { 'x-company-id': scope[1], 'Idempotency-Key': key },
      path: { businessId: scope[2], period },
    },
    body: {
      paid_method: body.paid_method,
      paid_on: body.paid_on,
      ...(body.paid_note === undefined ? {} : { paid_note: body.paid_note }),
    },
  });
  if (!result.response.ok) throw refusal(result.error ?? {}, result.response.status);
  return markCommissionStatementPaidResponse.parse(result.data);
}
