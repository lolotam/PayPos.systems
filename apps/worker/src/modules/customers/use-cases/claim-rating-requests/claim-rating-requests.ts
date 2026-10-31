import type { Clock } from '../../ports/clock.port.ts';
import type { DueRatingCursor } from '../../ports/rating-claim.repository.ts';
import type { RatingClaimTransactions } from '../../ports/rating-claim-transactions.port.ts';
import type { ClaimRatingRequest } from '../claim-rating-request/claim-rating-request.ts';

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
    const failed = await this.claimPages(companyId, this.clock.now());
    // الخطأ بيعدّ الطلبات اللي فشلت بس من غير أي معرّف، عشان الـ job يعيد الجولة.
    if (failed > 0) throw new Error(`RATING_CLAIMS_FAILED_${failed}`);
  }

  /**
   * يمشي على صفحات الاستحقاق بمفتاح (due_at, id) ويمطالب كل طلب في معاملته.
   *
   * @param companyId الشركة المالكة للطلبات
   * @param now لحظة الجولة، وكل الصفحة بتقارن بيها
   * @returns عدد الطلبات اللي فشلت في الجولة
   */
  private async claimPages(companyId: string, now: Date): Promise<number> {
    let failed = 0;
    let after: DueRatingCursor | null = null;
    for (;;) {
      const page = await this.transactions.due(companyId, now, RATING_CLAIM_PAGE, after);
      for (const request of page) {
        // كل طلب في معاملته لوحده، وفشل واحد ما بيوقّفش الباقي.
        try {
          await this.transactions.claim(companyId, async (tx) => {
            await this.claim.execute(tx, { companyId, request });
          });
        } catch {
          failed += 1;
        }
      }
      const last = page.at(-1);
      if (last === undefined || page.length < RATING_CLAIM_PAGE) return failed;
      after = { dueAt: last.dueAt, id: last.id };
    }
  }
}
