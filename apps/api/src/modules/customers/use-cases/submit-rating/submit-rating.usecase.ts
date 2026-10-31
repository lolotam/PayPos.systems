import { submitRatingInput } from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { parseRatingToken } from '../../domain/rating-token.ts';
import type { RatingSubmitTransactions } from '../../ports/rating-submission.port.ts';
import type { RatingTokenHash } from '../../ports/rating-token-hash.port.ts';

export { RatingSubmissionBusyError } from '../../ports/rating-submission.port.ts';

/** نتيجة إرسال التقييم: اتسلم، أو الرابط مش متاح، أو جسم الطلب غلط. */
export type SubmitRatingOutcome = 'SUBMITTED' | 'UNAVAILABLE' | 'INVALID';

/** طلب إرسال التقييم: التوكن في الهيدر هو الاعتماد كله، ومن غير جلسة (D-B10، ADR-0011 §4). */
export interface SubmitRatingInput {
  /** التوكن كما وصل، بالصيغة القانونية `<شركة>.<43 حرفاً>`. */
  readonly token: string;
  /** جسم الطلب كما وصل؛ بيتحقق منه هنا مش في الـ pipe. */
  readonly body: unknown;
}

/**
 * يسجّل تقييم العميل على طلبه.
 * الخطوة: يتحقق من جسم الطلب الأول، يقرأ التوكن ويتحقق من صيغته، يحسب بصمته، ويفتح معاملة واحدة
 * على الشركة المختارة من بادئة الرابط. جوه المعاملة: يقفل صف الطلب، وبعد القفل يقرأ الساعة، وبعدين
 * يستهلك الطلب ويحفظ التقييم ونسبه — كل ده في نفس المعاملة، فأي فشل بيرجّع الاستهلاك (ADR-0011 §2).
 */
export class SubmitRatingUseCase {
  readonly #transactions: RatingSubmitTransactions;
  readonly #hash: RatingTokenHash;
  readonly #clock: Clock;

  constructor(transactions: RatingSubmitTransactions, hash: RatingTokenHash, clock: Clock) {
    this.#transactions = transactions;
    this.#hash = hash;
    this.#clock = clock;
  }

  /**
   * @param input التوكن كما وصل في الهيدر، وجسم الطلب
   * @returns `SUBMITTED` لما التقييم اتسلم، `UNAVAILABLE` لما التوكن مش متاح، و`INVALID` لما الجسم غلط
   */
  async execute(input: SubmitRatingInput): Promise<SubmitRatingOutcome> {
    // التحقق من الجسم قبل ما نلمس التوكن: جسم غلط ما بيستهلكش الرابط ولا بيفتح معاملة.
    const parsed = submitRatingInput.safeParse(input.body);
    if (!parsed.success) return 'INVALID';
    const token = parseRatingToken(input.token);
    if (token === null) return 'UNAVAILABLE';
    const tokenHash = this.#hash.sha256(token.canonical);
    const note = parsed.data.comment;
    // التعليق الفاضي معناه مفيش تعليق، مش تعليق فاضي.
    const comment = note === undefined || note === '' ? null : note;
    return this.#transactions.run(token.companyId, async (scope) => {
      const locked = await scope.lockRequest(tokenHash);
      if (!locked) return 'UNAVAILABLE';
      // الساعة بعد القفل: رابط خلص صلاحيته أثناء الانتظار على القفل لازم يترفض، مش يتقبل بتأخير.
      const now = this.#clock.now();
      const consumed = await scope.consumeAndRate({
        tokenHash,
        now,
        stars: parsed.data.stars,
        comment,
      });
      // صفر صفوف يعني إن الرابط خلص أو اتستهلك من زاوية تانية: التقييم مش بيتسجل مرتين.
      if (!consumed) return 'UNAVAILABLE';
      // TODO(spec): 61-1 appends LowRatingReceived here when stars ≤ 2 and the LOW_RATING rule is on
      return 'SUBMITTED';
    });
  }
}
