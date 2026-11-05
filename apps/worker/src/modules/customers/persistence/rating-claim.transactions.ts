import type { TenantWrappers, Tx } from '@pospay/db';
import type { RatingClaimTransactions } from '../ports/rating-claim-transactions.port.ts';
import { ratingClaimRepository } from './rating-claim.repository.ts';

/** مهلة معاملة المستأجر الواحدة: ثانية واحدة تكفي للقراءة والمطالبة على صف واحد. */
const TENANT_TIMEOUT_MS = 1000;

/**
 * يفتح معاملات المجدول على داتابيز المستأجر: كل قراءة حدود في معاملة مستقلة، والطلب
 * الواحد في معاملته الخاصة اللي بتتقفل قبل ما الشغل يرجع.
 *
 * @param database أغلفة المستأجر من جذر الـ worker
 * @returns معاملات المجدول
 */
export function ratingClaimTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
): RatingClaimTransactions<Tx> {
  return {
    upperId: (companyId) =>
      database.withTenant(companyId, (tx) => ratingClaimRepository.upperId(tx, companyId), {
        timeoutMs: TENANT_TIMEOUT_MS,
      }),
    pageIds: (companyId, after, through, limit) =>
      database.withTenant(
        companyId,
        (tx) => ratingClaimRepository.pageIds(tx, companyId, after, through, limit),
        { timeoutMs: TENANT_TIMEOUT_MS },
      ),
    withRequest: (companyId, requestId, work) =>
      database.withTenant(
        companyId,
        async (tx) => work(tx, await ratingClaimRepository.findRequest(tx, companyId, requestId)),
        { timeoutMs: TENANT_TIMEOUT_MS },
      ),
  };
}
