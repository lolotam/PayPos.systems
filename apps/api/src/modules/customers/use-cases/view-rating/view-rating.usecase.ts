import type { RatingView } from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import {
  isRatingViewable,
  ratingBusinessName,
  ratingViewStateOf,
} from '../../domain/rating-submission.ts';
import { parseRatingToken } from '../../domain/rating-token.ts';
import type { RatingSubmissionTransactions } from '../../ports/rating-submission.port.ts';
import type { RatingTokenHash } from '../../ports/rating-token-hash.port.ts';

export { RatingSubmissionBusyError } from '../../ports/rating-submission.port.ts';

/** نتيجة عرض صفحة التقييم: بيانات الصفحة، أو الرابط مش متاح. */
export type ViewRatingOutcome = RatingView | 'UNAVAILABLE';

/** طلب عرض صفحة التقييم: التوكن في الهيدر هو الاعتماد كله، ومن غير جلسة (D-B10، ADR-0011 §4). */
export interface ViewRatingInput {
  /** التوكن كما وصل، بالصيغة القانونية `<شركة>.<43 حرفاً>`. */
  readonly token: string;
}

/**
 * يعرض صفحة التقييم: اسم النشاط بلغة العميل، وحالة الرابط.
 * الخطوة: يقرأ التوكن، يتحقق من صيغته، يحسب بصمته، ويفتح معاملة واحدة على الشركة المختارة من بادئة الرابط.
 * المعاملة بتقرأ بس: الصفحة ما بتقفلش صف وما بتكتبش، والرابط المنتهي بيرد بنفس رد الرابط المجهول.
 */
export class ViewRatingUseCase {
  readonly #transactions: RatingSubmissionTransactions;
  readonly #hash: RatingTokenHash;
  readonly #clock: Clock;

  constructor(transactions: RatingSubmissionTransactions, hash: RatingTokenHash, clock: Clock) {
    this.#transactions = transactions;
    this.#hash = hash;
    this.#clock = clock;
  }

  /**
   * @param input التوكن كما وصل في الهيدر
   * @returns بيانات الصفحة، أو `UNAVAILABLE` لما التوكن مش موجود أو خلصت صلاحيته
   */
  async execute(input: ViewRatingInput): Promise<ViewRatingOutcome> {
    const parsed = parseRatingToken(input.token);
    if (parsed === null) return 'UNAVAILABLE';
    const tokenHash = this.#hash.sha256(parsed.canonical);
    return this.#transactions.run(parsed.companyId, async (scope) => {
      const row = await scope.findView(tokenHash);
      if (row === null) return 'UNAVAILABLE';
      if (!isRatingViewable(row.expiresAt, this.#clock.now())) return 'UNAVAILABLE';
      // الرابط المستهلك بيفضل معروضاً بحالة «تم الإرسال» لحد ما صلاحيته تخلص (ADR-0011 §4).
      return {
        business_name: ratingBusinessName(row.locale, row.nameAr, row.nameEn),
        state: ratingViewStateOf(row.consumedAt),
      };
    });
  }
}
