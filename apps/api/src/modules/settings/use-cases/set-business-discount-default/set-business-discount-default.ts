import type { DiscountLimitInput } from '@pospay/contracts';
import { ApiError } from '../../../../shared/errors.ts';
import type { SettingsCache, SettingsTransactions } from '../../ports/settings.port.ts';

// بيغير افتراضي خصم النشاط بالسبب بعد فحص سلطة المدير تحت القفل، والتدقيق جزء من نفس المعاملة.
export class SetBusinessDiscountDefault {
  constructor(
    private readonly transactions: SettingsTransactions,
    private readonly cache: SettingsCache,
  ) {}

  async execute(
    actor: { companyId: string; userId: string },
    businessId: string,
    input: DiscountLimitInput,
  ) {
    const reason = input.reason.trim();
    if (!reason || reason.length > 500) throw new ApiError('VALIDATION_FAILED');
    const saved = await this.transactions.run(actor.companyId, actor.userId, async (scope) => {
      const access = await scope.discountAccess.check(businessId);
      if (access.failure !== null) throw new ApiError(access.failure);
      const before = await scope.findForUpdate(businessId);
      const after = await scope.save(businessId, { limitBps: input.limit_bps }, actor.userId);
      await scope.audit.record({
        entity: 'business_discount_limit',
        entityId: businessId,
        action:
          input.limit_bps === null
            ? 'business_discount_limit.cleared'
            : 'business_discount_limit.set',
        before: { business_id: businessId, limit_bps: before?.limitBps ?? null },
        after: {
          business_id: businessId,
          limit_bps: after.limitBps,
          reason,
          permission_code: 'manage:discounts:company',
          decided_at: access.decidedAt,
        },
      });
      return { limit_bps: after.limitBps };
    });
    await this.cache.invalidate(actor.companyId, businessId);
    return saved;
  }
}
