import type { TenantWrappers } from '@pospay/db';
import type { RatingClaimTransactions } from '../ports/rating-claim-transactions.port.ts';
import { ratingClaimRepository } from './rating-claim.repository.ts';

/**
 * يفتح معاملات المطالبة على داتابيز المستأجر: جولة الاستحقاق في معاملة، وكل طلب في معاملته.
 *
 * @param database أغلفة المستأجر من جذر الـ worker
 * @returns معاملات المطالبة
 */
export function ratingClaimTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
): RatingClaimTransactions {
  return {
    due: (companyId, now, limit, after) =>
      database.withTenant(companyId, (tx) =>
        ratingClaimRepository.due(tx, companyId, now, limit, after),
      ),
    claim: (companyId, work) => database.withTenant(companyId, work),
  };
}
