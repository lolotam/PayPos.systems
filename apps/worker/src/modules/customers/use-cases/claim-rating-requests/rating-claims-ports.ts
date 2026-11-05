import type { RatingClaimDiagnostics } from '../../ports/rating-claim-diagnostics.port.ts';
import type { RatingClaimRepository } from '../../ports/rating-claim.repository.ts';
import type { RatingClaimState } from '../../ports/rating-claim-state.port.ts';
import type { RatingClaimTransactions } from '../../ports/rating-claim-transactions.port.ts';
import type {
  ClaimOutcome,
  ClaimRatingRequestInput,
} from '../claim-rating-request/claim-rating-request.ts';

/** منفذ المطالبة على الطلب الواحد: هو نفسه مسار المطالبة، من غير أي تغيير. */
export interface RatingClaimsClaim<Transaction = unknown> {
  /**
   * يطالب بطلب التقييم جوه المعاملة المفتوحة.
   *
   * @param tx معاملة المستأجر المفتوحة
   * @param input الشركة والطلب المقروء
   * @returns نتيجة المطالبة
   */
  execute(tx: Transaction, input: ClaimRatingRequestInput): Promise<ClaimOutcome>;
}

/** منافذ دور المطالبة: حالة الجدولة، والمعاملات، وإعادة القراءة، والمطالبة، والتشخيص. */
export interface RatingClaimsPorts<Transaction = unknown> {
  /** حالة الجدولة في Redis، وهي الحدّ الشبكي للدور كله. */
  readonly state: RatingClaimState;
  /** معاملات المستأجر لقراءة حدود الجولة وقراءة الطلب الواحد. */
  readonly transactions: RatingClaimTransactions<Transaction>;
  /** إعادة قراءة الطلب في نفس معاملة المطالبة. */
  readonly requests: Pick<RatingClaimRepository<Transaction>, 'findRequest'>;
  /** المطالبة نفسها. */
  readonly claim: RatingClaimsClaim<Transaction>;
  /** تشخيص الدور: الفشل، والفيضان، وفقد السور، والملخص. */
  readonly diagnostics: RatingClaimDiagnostics;
}
