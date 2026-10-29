import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { ratingOptOutDecision } from '../../domain/rating-opt-out.ts';
import { parseRatingToken } from '../../domain/rating-token.ts';
import type { RatingOptOutTransactions } from '../../ports/rating-opt-out.port.ts';
import type { RatingTokenHash } from '../../ports/rating-token-hash.port.ts';

export { RatingOptOutBusyError } from '../../ports/rating-opt-out.port.ts';

/** نتيجة رفض التقييم: اتقبل، أو الرابط مش متاح. */
export type OptOutOfRatingsOutcome = 'ACCEPTED' | 'UNAVAILABLE';

/** طلب رفض التقييم العام: التوكن في الهيدر هو الاعتماد كله، ومن غير جلسة (D-B10، ADR-0011 §4). */
export interface OptOutOfRatingsInput {
  /** التوكن كما وصل، بالصيغة القانونية `<شركة>.<43 حرفاً>`. */
  readonly token: string;
}

/**
 * يوقف رسائل التقييم عن العميل صاحب رابط التقييم.
 * الخطوة: يقرأ التوكن، يتحقق من صيغته، يحسب بصمته، ويفتح معاملة واحدة على الشركة المختارة من بادئة الرابط.
 * جوه المعاملة: يقرأ الطلب من غير قفل، يقفل صف العميل، وبعدها بس يقرأ الساعة — فالوقت بيتقاس بعد القفل
 * عشان رابط خلص صلاحيته أثناء الانتظار يترفض. الرفض كتابة واحدة بس، وسجل التدقيق بيتم معاها.
 */
export class OptOutOfRatingsUseCase {
  readonly #transactions: RatingOptOutTransactions;
  readonly #hash: RatingTokenHash;
  readonly #clock: Clock;

  constructor(
    transactions: RatingOptOutTransactions,
    hash: RatingTokenHash,
    clock: Clock,
  ) {
    this.#transactions = transactions;
    this.#hash = hash;
    this.#clock = clock;
  }

  /**
   * @param input التوكن كما وصل في الهيدر
   * @returns `ACCEPTED` لما العميل بقى رافض، و`UNAVAILABLE` لما التوكن مش موجود أو خلصت صلاحيته
   */
  async execute(input: OptOutOfRatingsInput): Promise<OptOutOfRatingsOutcome> {
    const parsed = parseRatingToken(input.token);
    if (parsed === null) return 'UNAVAILABLE';
    const tokenHash = this.#hash.sha256(parsed.canonical);
    return this.#transactions.run(parsed.companyId, async (scope) => {
      const request = await scope.findRequest(tokenHash);
      if (request === null) return 'UNAVAILABLE';
      const customer = await scope.lockCustomer(request.customerId);
      if (customer === null) return 'UNAVAILABLE';
      // الساعة بعد القفل: رابط خلص صلاحيته أثناء الانتظار على القفل لازم يترفض، مش يتقبل بتأخير.
      const now = this.#clock.now();
      const decision = ratingOptOutDecision(request.expiresAt, now, customer.optedOutAt);
      if (decision === 'LINK_UNAVAILABLE') return 'UNAVAILABLE';
      if (decision === 'ALREADY_OPTED_OUT') return 'ACCEPTED';
      const written = await scope.markOptedOut(request.customerId, now);
      // صفر صفوف يعني إن منافس كتب قبلك — الرفض تم، بس السجل بتاعنا مش بيتكتب مرتين.
      if (!written) return 'ACCEPTED';
      await scope.audit.record({
        entity: 'customer',
        entityId: request.customerId,
        action: 'customer.opted_out',
        after: { opted_out_at: now.toISOString() },
      });
      return 'ACCEPTED';
    });
  }
}
