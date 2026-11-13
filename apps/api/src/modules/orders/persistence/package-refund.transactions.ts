import {
  IdempotencyKeyReusedError,
  appendAuditLogs,
  appendOutboxEvent,
  runIdempotent,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { packageSaleChanged } from '@pospay/contracts';
import { lockPackageRefundAccess, readPackageRefundAccess } from '../../identity/index.ts';
import { readImportedRefundsEnabled } from '../../settings/index.ts';
import { packageSalePlace } from '../../tenancy/index.ts';
import { PackageRuleError } from '../domain/errors.ts';
import { PackageRefundError } from '../domain/package-refund-error.ts';
import { SessionError } from '../domain/session-error.ts';
import type {
  LockedRefundSlot,
  PackageRefundAccessPort,
  PackageRefundRecords,
  PackageRefundTransaction,
  PackageRefundTransactions,
} from '../ports/package-refund.port.ts';
import type { SessionWriteContext } from '../ports/service-session-transactions.port.ts';
import {
  insertPackageRefund,
  insertPackageRefundSlots,
  lockRefundComponent,
  lockRefundEntitlement,
  lockRefundSlots,
  markPackageSlotsRefunded,
  updateRefundEntitlement,
} from './package-refund-records.ts';
import { cleanSessionWrite } from './session-recovery-proof.ts';

const OPERATION = 'refund-package';

type RefundScope = Readonly<{
  companyId: string;
  businessId: string;
  branchId: string;
}>;

export function createPackageRefundTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): PackageRefundTransactions {
  return {
    run: async (context, work) => {
      try {
        return await database.withTenant(
          context.companyId,
          (tx) => work(packageRefundTransaction(tx, context, ids)),
          { userId: context.userId },
        );
      } catch (error) {
        return mapPackageRefundError(error);
      }
    },
  };
}

function packageRefundTransaction(
  tx: Tx,
  context: SessionWriteContext,
  ids: IdGenerator,
): PackageRefundTransaction {
  const scope: RefundScope = {
    companyId: context.companyId,
    businessId: context.businessId,
    branchId: context.branchId,
  };
  return {
    access: refundAccess(tx, context),
    place: {
      timezone: () => packageSalePlace(tx, context.companyId, context.businessId, context.branchId),
    },
    settings: {
      importedRefundsEnabled: () =>
        readImportedRefundsEnabled(tx, context.companyId, context.businessId),
    },
    packages: refundRecords(tx, scope, ids),
    idempotent: (handler) => claimPackageRefund(tx, context, handler),
    audit: (id, entry) => appendAuditLogs(tx, [{ id, entry }]),
    emit: async (payload) => {
      const parsed = packageSaleChanged.parse(payload);
      await appendOutboxEvent(tx, ids.newId(), {
        aggregateType: 'package_entitlement',
        aggregateId: parsed.sale_id,
        eventType: 'PackageSaleChanged',
        payload: parsed,
      });
    },
  };
}

function refundAccess(tx: Tx, context: SessionWriteContext): PackageRefundAccessPort {
  return {
    lock: () => lockPackageRefundAccess(tx, context.companyId),
    read: async (at) => {
      const facts = await readPackageRefundAccess(
        tx,
        context.companyId,
        context.userId,
        context.businessId,
        context.branchId,
        at,
      );
      return { ...facts, eligible: facts.eligible.map((actor) => actor.membership_id) };
    },
  };
}

function refundRecords(tx: Tx, scope: RefundScope, ids: IdGenerator): PackageRefundRecords {
  const locked = new Map<number, LockedRefundSlot>();
  return {
    lockEntitlement: (entitlementId) => lockRefundEntitlement(tx, scope, entitlementId),
    lockComponent: (entitlementId, componentId) =>
      lockRefundComponent(tx, scope, entitlementId, componentId),
    lockSlots: async (entitlementId, componentId) => {
      const slots = await lockRefundSlots(tx, scope, entitlementId, componentId);
      locked.clear();
      for (const slot of slots) locked.set(slot.ordinal, slot);
      return slots;
    },
    insertRefund: (refund) => insertPackageRefund(tx, scope, refund),
    insertRefundSlots: (refund, ordinals) =>
      insertPackageRefundSlots(tx, scope, ids, refund, selectSlots(locked, ordinals)),
    markSlotsRefunded: (ordinals, sessions) =>
      markPackageSlotsRefunded(tx, scope, selectSlots(locked, ordinals), sessions),
    updateEntitlement: (entitlementId, refundedAmount, revision) =>
      updateRefundEntitlement(tx, scope, entitlementId, refundedAmount, revision),
  };
}

function selectSlots(
  locked: ReadonlyMap<number, LockedRefundSlot>,
  ordinals: readonly number[],
): readonly LockedRefundSlot[] {
  const selected = ordinals.map((ordinal) => locked.get(ordinal));
  if (selected.some((slot) => slot === undefined)) throw new PackageRuleError('INSUFFICIENT_SLOTS');
  return selected.filter((slot): slot is LockedRefundSlot => slot !== undefined);
}

async function claimPackageRefund<T>(
  tx: Tx,
  context: SessionWriteContext,
  handler: () => Promise<T>,
) {
  const result = await runIdempotent(
    tx,
    {
      scope: 'COMPANY',
      operation: OPERATION,
      key: context.key,
      fingerprint: context.fingerprint,
    },
    async () => ({ status: 201, body: await handler() }),
  );
  return { body: result.body as T, replayed: result.replayed };
}

function mapPackageRefundError(error: unknown): never {
  if (
    error instanceof PackageRefundError ||
    error instanceof PackageRuleError ||
    error instanceof SessionError
  ) {
    throw error;
  }
  if (error instanceof IdempotencyKeyReusedError) {
    throw new PackageRefundError('IDEMPOTENCY_KEY_REUSED');
  }
  cleanSessionWrite(error);
}
