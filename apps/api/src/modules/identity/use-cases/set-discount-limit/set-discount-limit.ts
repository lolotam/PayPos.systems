import type { DiscountLimitInput } from '@pospay/contracts';
import { discountLimitEditFailure } from '../../domain/discount-limit-edit.ts';
import { validateDiscountLimitBps } from '../../domain/discount-limit.ts';
import type { DiscountLimitTransactions } from '../../ports/discount-limit.port.ts';
import type { GrantInvalidator } from '../../ports/permission-overrides.port.ts';
import { ApiError } from '../../../../shared/errors.ts';

// بيغير معامل الخصم الشخصي أو يمسحه مع السبب والتدقيق ثم يبطل نسخة الصلاحيات بعد commit.
export class SetDiscountLimit {
  constructor(
    private readonly transactions: DiscountLimitTransactions,
    private readonly invalidator: GrantInvalidator,
  ) {}

  async execute(
    actor: { companyId: string; userId: string },
    membershipId: string,
    input: DiscountLimitInput,
  ) {
    const limit = input.limit_bps;
    if (limit !== null) validateDiscountLimitBps(limit);
    const reason = input.reason.trim();
    if (reason.length === 0 || reason.length > 500) throw new ApiError('VALIDATION_FAILED');
    const saved = await this.transactions.run(actor.companyId, actor.userId, async (scope) => {
      const context = await scope.context(membershipId);
      const failure = discountLimitEditFailure(context);
      if (failure !== null) throw new ApiError(failure);
      const before = await scope.current(membershipId);
      await scope.save(membershipId, limit);
      await scope.audit.record({
        entity: 'membership_discount_limit',
        entityId: membershipId,
        action: limit === null ? 'discount_limit.cleared' : 'discount_limit.set',
        before: { membership_id: membershipId, limit_bps: before },
        after: {
          membership_id: membershipId,
          limit_bps: limit,
          reason,
          permission_code: 'manage:discounts:company',
          decided_at: context.now.toISOString(),
        },
      });
      return { limit_bps: limit };
    });
    await this.invalidator.invalidate(actor.companyId, membershipId);
    return saved;
  }
}
