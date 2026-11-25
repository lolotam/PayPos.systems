import type { RatingSentRepository } from '../../ports/rating-sent.repository.ts';

/** مدخلات تسجيل القبول: الشركة وحدث الجاهزية الذي ينتمي إليه الطلب ولحظة قبول المزود. */
export interface RecordRatingRequestSentInput {
  readonly companyId: string;
  readonly readyEventId: string;
  readonly sentAt: Date;
}

/** خطوة العمل: لما المزود يقبل رسالة التقييم ينتقل الطلب من SENDING إلى SENT مرة واحدة (D-B8، FR-B09). */
export class RecordRatingRequestSent<Transaction> {
  constructor(private readonly requests: RatingSentRepository<Transaction>) {}

  async execute(tx: Transaction, input: RecordRatingRequestSentInput): Promise<boolean> {
    return this.requests.markSent(tx, input.companyId, input.readyEventId, input.sentAt);
  }
}
