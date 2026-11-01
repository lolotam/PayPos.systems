import type { Clock } from '../../ports/clock.port.ts';
import type { RatingClaimDiagnostics } from '../../ports/rating-claim-diagnostics.port.ts';
import type { DueRatingCursor } from '../../ports/rating-claim.repository.ts';
import type { RatingClaimTransactions } from '../../ports/rating-claim-transactions.port.ts';
import type { ClaimRatingRequest } from '../claim-rating-request/claim-rating-request.ts';

export type { DueRatingCursor } from '../../ports/rating-claim.repository.ts';

/** أقصى عدد طلبات بتتقرأ وبتتعالج في جولة استحقاق واحدة. */
export const RATING_CLAIM_PAGE = 100;

/** فشل جزء من صفحة، وحافظ على مؤشرها حتى لا يحبس الطلبات اللي بعدها في الجولات الجاية. */
export class RatingClaimsFailedError extends Error {
  constructor(
    failed: number,
    readonly after: DueRatingCursor | null,
  ) {
    super(`RATING_CLAIMS_FAILED_${failed}`);
    this.name = 'RatingClaimsFailedError';
  }
}

/** يطالب بصفحة واحدة من طلبات التقييم المستحقة، بمعاملة مستقلة لكل طلب. */
export class ClaimRatingRequests<Transaction = unknown> {
  constructor(
    private readonly transactions: RatingClaimTransactions<Transaction>,
    private readonly claim: ClaimRatingRequest<Transaction>,
    private readonly clock: Clock,
    private readonly diagnostics: RatingClaimDiagnostics,
  ) {}

  async execute(
    companyId: string,
    after: DueRatingCursor | null = null,
  ): Promise<DueRatingCursor | null> {
    const page = await this.transactions.due(companyId, this.clock.now(), RATING_CLAIM_PAGE, after);
    let failed = 0;
    for (const request of page) {
      // كل طلب في معاملته لوحده، وفشل واحد يتشخّص وما يوقّفش الباقي.
      try {
        await this.transactions.claim(companyId, async (tx) => {
          await this.claim.execute(tx, { companyId, request });
        });
      } catch (error) {
        this.diagnostics.failed(companyId, error);
        failed += 1;
      }
    }
    const last = page.at(-1);
    const continuation =
      page.length === RATING_CLAIM_PAGE && last !== undefined
        ? { dueAt: last.dueAt, id: last.id }
        : null;
    if (failed > 0) throw new RatingClaimsFailedError(failed, continuation);
    return continuation;
  }
}
