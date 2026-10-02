import type { RevokePermissionOverrideInput } from '@pospay/contracts';
import { permissionEditFailure } from '../../domain/permission-edit.ts';
import { overrideLifecycleFailure } from '../../domain/permission-override-lifecycle.ts';
import type {
  GrantInvalidator,
  PermissionOverrideTransactions,
} from '../../ports/permission-overrides.port.ts';
import { ApiError } from '../../../../shared/errors.ts';

// بينهي الاستثناء بسبب إلزامي مع تدقيقه، وبعد commit يبطل منح العضوية.
export class RevokePermissionOverride {
  constructor(
    private readonly transactions: PermissionOverrideTransactions,
    private readonly invalidator: GrantInvalidator,
  ) {}

  async execute(
    actor: { companyId: string; userId: string },
    membershipId: string,
    overrideId: string,
    input: RevokePermissionOverrideInput,
  ) {
    const saved = await this.transactions.run(actor.companyId, actor.userId, async (scope) => {
      const found = await scope.find(membershipId, overrideId);
      if (found === null) throw new ApiError('NOT_FOUND');
      const context = await scope.context(membershipId, found);
      const previous = await scope.find(membershipId, overrideId);
      if (previous === null) throw new ApiError('NOT_FOUND');
      const failure = permissionEditFailure(previous, context, 'REVOKE');
      if (failure !== null) throw new ApiError(failure);
      const lifecycle = overrideLifecycleFailure(
        'REVOKE',
        [previous],
        context.membership?.roleCode === 'owner',
        context.now,
      );
      if (lifecycle !== null) throw new ApiError(lifecycle);
      const ended = await scope.end(membershipId, overrideId, context.now);
      await scope.audit.record({
        entity: 'permission_override',
        entityId: ended.id,
        action: 'permission.revoked',
        before: { ...previous, membership_id: membershipId },
        after: { ...ended, membership_id: membershipId, reason: input.reason },
      });
      return ended;
    });
    await this.invalidator.invalidate(actor.companyId, membershipId);
    return saved;
  }
}
