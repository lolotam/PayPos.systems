import {
  IdempotencyKeyReusedError,
  appendAuditLogs,
  runIdempotent,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { lockPackageExtensionAccess, readPackageExtensionAccess } from '../../identity/index.ts';
import { packageSalePlace } from '../../tenancy/index.ts';
import { PackageRuleError } from '../domain/errors.ts';
import { PackageExtensionError } from '../domain/package-extension-error.ts';
import { SessionError } from '../domain/session-error.ts';
import type {
  PackageExtensionTransaction,
  PackageExtensionTransactions,
} from '../ports/package-extension.port.ts';
import type { SessionWriteContext } from '../ports/service-session-transactions.port.ts';
import {
  insertPackageExtension,
  lockPackageEntitlement,
  updatePackageExpiry,
} from './package-extension-records.ts';
import { cleanSessionWrite } from './session-recovery-proof.ts';

const OPERATION = 'extend-package';

export function createPackageExtensionTransactions(
  database: TenantWrappers,
): PackageExtensionTransactions {
  return {
    run: async (context, work) => {
      try {
        return await database.withTenant(
          context.companyId,
          (tx) => work(packageExtensionTransaction(tx, context)),
          { userId: context.userId },
        );
      } catch (error) {
        return mapPackageExtensionError(error);
      }
    },
  };
}

function packageExtensionTransaction(
  tx: Tx,
  context: SessionWriteContext,
): PackageExtensionTransaction {
  const scope = {
    companyId: context.companyId,
    businessId: context.businessId,
    branchId: context.branchId,
  };
  return {
    access: {
      lock: () => lockPackageExtensionAccess(tx, context.companyId),
      read: async (at) => {
        const facts = await readPackageExtensionAccess(
          tx,
          context.companyId,
          context.userId,
          context.businessId,
          context.branchId,
          at,
        );
        return { ...facts, eligible: facts.eligible.map((actor) => actor.membership_id) };
      },
    },
    place: {
      timezone: () => packageSalePlace(tx, context.companyId, context.businessId, context.branchId),
    },
    packages: {
      lock: (entitlementId) => lockPackageEntitlement(tx, scope, entitlementId),
      insert: (extension) => insertPackageExtension(tx, scope, extension),
      updateExpiry: (entitlementId, expectedExpiresOn, newExpiresOn) =>
        updatePackageExpiry(tx, scope, entitlementId, expectedExpiresOn, newExpiresOn),
    },
    idempotent: (handler) => claimPackageExtension(tx, context, handler),
    audit: (id, entry) => appendAuditLogs(tx, [{ id, entry }]),
  };
}

async function claimPackageExtension<T>(
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

function mapPackageExtensionError(error: unknown): never {
  if (
    error instanceof PackageExtensionError ||
    error instanceof PackageRuleError ||
    error instanceof SessionError
  ) {
    throw error;
  }
  if (error instanceof IdempotencyKeyReusedError) {
    throw new PackageExtensionError('IDEMPOTENCY_KEY_REUSED');
  }
  cleanSessionWrite(error);
}
