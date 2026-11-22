import {
  isLowRating,
  lowRatingDelivery,
  lowRatingDetails,
  noticeComment,
  noticeRecipients,
  ratingMatchesEvent,
  recipientGroups,
  sortedUnique,
} from '../../domain/low-rating-notice.ts';
import type { Clock, IdGenerator } from '../../ports/clock.port.ts';
import type { LowRatingEvent, LowRatingPorts } from '../../ports/low-rating-notice.ports.ts';

/** يقرر جرس التقييم المنخفض مرة واحدة لكل تقييم داخل معاملة المستهلك ويركّب مجموعات الإشعار. */
export class RequestLowRatingNotice {
  constructor(
    private readonly ports: LowRatingPorts,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(event: LowRatingEvent): Promise<void> {
    const stored = await this.ports.repository.readRating(event);
    if (stored === null || !ratingMatchesEvent(event, stored))
      throw new Error('LOW_RATING_EVENT_INVALID');
    if (!isLowRating(stored.stars)) return;
    const stars = stored.stars;
    if (!(await this.ports.place.companyOpen(event.companyId))) return;
    const scope = { businessId: event.businessId, branchId: event.branchId };
    const delivery = lowRatingDelivery(
      await this.ports.rules.rule(event.companyId, scope, 'LOW_RATING'),
    );
    const decidedAt = this.clock.now();
    const candidates = delivery.active
      ? await this.ports.recipients.managers(event, decidedAt, delivery.roles)
      : [];
    const branch = candidates.length === 0 ? null : await this.ports.place.forBranch(event);
    // فرع لم يعد موجودًا حالة نهائية لا تصلحها إعادة المحاولة: تُسجَّل كقرار بلا مستلمين.
    const users = branch === null ? [] : sortedUnique(candidates);
    const won = await this.ports.repository.claim(event, {
      id: this.ids.newId(),
      decidedAt,
      recipientCount: users.length,
    });
    if (!won || branch === null || users.length === 0) return;
    const { comment, readers } = await this.commentForReaders(
      event,
      stored.hasComment,
      users,
      decidedAt,
    );
    const customer = await this.ports.repository.readCustomer(event, stored.customerId);
    if (customer === null) throw new Error('LOW_RATING_CONTEXT_MISSING');
    const details = lowRatingDetails({
      stars,
      branch,
      businessDate: stored.businessDate,
      performers: await this.ports.repository.performers(event),
      customer,
    });
    for (const group of recipientGroups(users, readers, comment))
      await this.ports.outbox.append(this.ids.newId(), event.ratingId, {
        business_id: event.businessId,
        branch_id: event.branchId,
        notification_recipients: noticeRecipients(group, details),
      });
  }

  /** نص التعليق لا يُقرأ إلا لما يوجد تعليق وقارئ مخوّل؛ غير ذلك يبقى النص خارج الذاكرة. */
  private async commentForReaders(
    event: LowRatingEvent,
    hasComment: boolean,
    users: readonly string[],
    decidedAt: Date,
  ): Promise<{ comment: string | null; readers: readonly string[] }> {
    if (!hasComment) return { comment: null, readers: [] };
    const readers = await this.ports.recipients.commentReaders(event, users, decidedAt);
    if (readers.length === 0) return { comment: null, readers };
    return { comment: noticeComment(await this.ports.repository.readComment(event)), readers };
  }
}
