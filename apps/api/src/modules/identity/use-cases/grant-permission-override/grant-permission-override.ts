import type { PermissionOverrideInput } from '@pospay/contracts';

import { permissionEditFailure, permissionEditingEnabled } from '../../domain/permission-edit.ts';
import type {
  GrantInvalidator,
  PermissionOverrideTransactions,
} from '../../ports/permission-overrides.port.ts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { ApiError } from '../../../../shared/errors.ts';

// بيضيف استثناء صلاحية مدقق في معاملة واحدة ثم يبطل إصدار المنح بعد نجاح commit.
export class GrantPermissionOverride {
  readonly editingEnabled = permissionEditingEnabled();
  constructor(
    private readonly transactions: PermissionOverrideTransactions,
    private readonly invalidator: GrantInvalidator,
    private readonly clock: Clock,
  ) {}

  async execute(
    actor: { companyId: string; userId: string },
    membershipId: string,
    terms: PermissionOverrideInput,
  ) {
    const saved = await this.transactions.run(actor.companyId, actor.userId, async (scope) => {
      const now = this.clock.now();
      const context = await scope.context(membershipId, terms, now);
      const failure = permissionEditFailure(terms, context);
      if (failure !== null) throw new ApiError(failure);
      const override = await scope.insert(membershipId, terms, now);
      if (override === null) throw new ApiError('PERMISSION_OVERRIDE_EXISTS');
      await scope.audit.record({
        entity: 'permission_override',
        entityId: override.id,
        action: 'permission.granted',
        before: null,
        after: { ...override, membership_id: membershipId },
      });
      return override;
    });
    await this.invalidator.invalidate(actor.companyId);
    return saved;
  }
}
