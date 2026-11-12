import type { ExtendPackageInput, PackageExtensionResponse } from '@pospay/contracts';
import { assertPackageExtensionAllowed } from '@pospay/domain';
import { PackageExtensionError } from '../../domain/package-extension-error.ts';
import { sessionBusinessDate } from '../../domain/session-time.ts';
import { normalizeWrittenReason } from '../../domain/written-reason.ts';
import type {
  PackageExtensionTransaction,
  PackageExtensionTransactions,
} from '../../ports/package-extension.port.ts';
import type {
  Clock,
  IdGenerator,
  SessionWriteContext,
} from '../../ports/service-session-transactions.port.ts';

type ExtendPackageContext = SessionWriteContext & {
  entitlementId: string;
  input: ExtendPackageInput;
};

/** يمدد استحقاق باقة للأمام ويحفظ تاريخ التمديد وأثره في معاملة واحدة. */
export class ExtendPackageUseCase {
  constructor(
    private readonly transactions: PackageExtensionTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(context: ExtendPackageContext): Promise<PackageExtensionResponse> {
    return this.transactions.run(context, async (tx) => {
      const result = await tx.idempotent(() => this.extend(tx, context));
      return result.body;
    });
  }

  private async extend(
    tx: PackageExtensionTransaction,
    context: ExtendPackageContext,
  ): Promise<PackageExtensionResponse> {
    await tx.access.lock();
    const locked = await tx.packages.lock(context.entitlementId);
    const at = this.clock.now();
    const access = await tx.access.read(at);
    const membershipId = access.eligible[0];
    if (access.denied || membershipId === undefined) throw new PackageExtensionError('FORBIDDEN');
    if (!access.feature) throw new PackageExtensionError('FEATURE_DISABLED');
    const timezone = await tx.place.timezone();
    if (timezone === null) throw new PackageExtensionError('FORBIDDEN');
    if (locked === null) throw new PackageExtensionError('PACKAGE_NOT_FOUND');
    if (context.input.expected_expires_on !== locked.expires_on) {
      throw new PackageExtensionError('PACKAGE_EXPIRY_STALE');
    }
    const today = sessionBusinessDate(at, timezone);
    assertPackageExtensionAllowed(today, locked.expires_on, context.input.new_expires_on);
    const reason = normalizeWrittenReason(context.input.reason, 'VALIDATION_FAILED');
    const id = this.ids.newId();
    await tx.packages.insert({
      id,
      entitlement_id: context.entitlementId,
      previous_expires_on: locked.expires_on,
      new_expires_on: context.input.new_expires_on,
      reason,
      extended_by: context.userId,
      extended_by_membership_id: membershipId,
      extended_at: at,
    });
    const updated = await tx.packages.updateExpiry(
      context.entitlementId,
      context.input.expected_expires_on,
      context.input.new_expires_on,
    );
    if (!updated) throw new PackageExtensionError('PACKAGE_EXPIRY_STALE');
    await tx.audit(this.ids.newId(), {
      entity: 'package_entitlement',
      entityId: context.entitlementId,
      action: 'package.extended',
      before: { expires_on: locked.expires_on },
      after: { expires_on: context.input.new_expires_on, extension_id: id },
    });
    return {
      id,
      entitlement_id: context.entitlementId,
      previous_expires_on: locked.expires_on,
      new_expires_on: context.input.new_expires_on,
      extended_at: at.toISOString(),
    };
  }
}

export { PackageExtensionError } from '../../domain/package-extension-error.ts';
export { PackageRuleError } from '../../domain/errors.ts';
export { SessionError } from '../../domain/session-error.ts';
