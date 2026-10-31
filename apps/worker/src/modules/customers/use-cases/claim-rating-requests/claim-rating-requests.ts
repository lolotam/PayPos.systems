import type { Clock } from '../../ports/clock.port.ts';
import type { RatingClaimTransactions } from '../../ports/rating-claim-transactions.port.ts';
import { ClaimRatingRequest } from '../claim-rating-request/claim-rating-request.ts';

/** أقصى عدد طلبات بتتقرأ في جولة استحقاق واحدة. */
export const RATING_CLAIM_PAGE = 100;

/** يطالب بكل طلبات التقييم المستحقة في شركة واحدة، بمعاملة مستقلة لكل طلب. */
export class ClaimRatingRequests {
  constructor(
    private readonly transactions: RatingClaimTransactions,
    private readonly claim: ClaimRatingRequest,
    private readonly clock: Clock,
  ) {}

  async execute(companyId: string): Promise<void> {
    const due = await this.transactions.due(companyId, this.clock.now(), RATING_CLAIM_PAGE);
    for (const request of due) {
      await this.transactions.claim(companyId, (tx) =>
        this.claim.execute(tx, { companyId, request }),
      );
    }
  }
}
