import type { RatingSettings } from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { RatingSettingsTransactions } from '../../ports/rating-settings.port.ts';

/**
 * بيبدّل مفتاح طلبات التقييم للنشاط: يكتب القيمة الجديدة ويسجّل التبديل في سجل التدقيق.
 * المفتاح مستقل عن مفتاح تنبيهات الفريق — قفل طلبات التقييم ما بيقفلش التنبيهات والعكس.
 */
export class SetRatingRequests {
  constructor(
    private readonly transactions: RatingSettingsTransactions,
    private readonly clock: Clock,
  ) {}

  /**
   * @param actor      الشركة والمستخدم اللي بيغيّر
   * @param businessId النشاط
   * @param enabled    القيمة الجديدة
   * @returns المفتاح بعد التبديل
   */
  async execute(
    actor: { companyId: string; userId: string },
    businessId: string,
    enabled: boolean,
  ): Promise<RatingSettings> {
    return this.transactions.run(actor.companyId, actor.userId, async (scope) => {
      const { before } = await scope.save({
        businessId,
        enabled,
        actorId: actor.userId,
        now: this.clock.now(),
      });
      await scope.audit.record({
        entity: 'customer',
        entityId: businessId,
        action: 'customer.rating_requests_switched',
        before: { requests_enabled: before },
        after: { requests_enabled: enabled },
      });
      return { requests_enabled: enabled };
    });
  }
}
