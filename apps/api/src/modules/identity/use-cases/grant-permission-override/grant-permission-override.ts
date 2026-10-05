import type { PermissionOverrideInput } from '@pospay/contracts';

import { permissionEditFailure, permissionHolderIsOwner } from '../../domain/permission-edit.ts';
import { overrideLifecycleFailure } from '../../domain/permission-override-lifecycle.ts';
import type {
  GrantInvalidator,
  PermissionOverrideTransactions,
} from '../../ports/permission-overrides.port.ts';
import { ApiError } from '../../../../shared/errors.ts';

// بيضيف استثناء صلاحية مدقق في معاملة واحدة ثم يبطل إصدار المنح بعد نجاح commit.
export class GrantPermissionOverride {
  constructor(
    private readonly transactions: PermissionOverrideTransactions,
    private readonly invalidator: GrantInvalidator,
  ) {}

  async execute(
    actor: { companyId: string; userId: string; businessId?: string },
    membershipId: string,
    terms: PermissionOverrideInput,
  ) {
    const saved = await this.transactions.run(actor.companyId, actor.userId, async (scope) => {
      const context = {
        ...(await scope.context(membershipId, terms)),
        ...(actor.businessId === undefined ? {} : { managementBusinessId: actor.businessId }),
      };
      const now = context.now;
      const failure = permissionEditFailure(terms, context);
      if (failure !== null) throw new ApiError(failure);
      const previous = await scope.current(membershipId, terms, now);
      const lifecycle = overrideLifecycleFailure(
        'SAVE',
        previous,
        permissionHolderIsOwner(context),
        now,
      );
      if (lifecycle !== null) throw new ApiError(lifecycle);
      for (const row of previous) await scope.end(membershipId, row.id, now);
      const override = await scope.insert(membershipId, terms, now);
      await scope.audit.record({
        entity: 'permission_override',
        entityId: override.id,
        action: previous.length === 0 ? 'permission.granted' : 'permission.replaced',
        before:
          previous.length === 0
            ? null
            : previous.map((row) => ({ ...row, membership_id: membershipId })),
        after: { ...override, membership_id: membershipId },
      });
      return override;
    });
    await this.invalidator.invalidate(actor.companyId, membershipId);
    return saved;
  }
}
