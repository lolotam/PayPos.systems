import {
  IdempotencyKeyReusedError,
  appendOutboxEvent,
  runIdempotent,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { lockPackageSaleAccess, readPackageSaleAccess } from '../../identity/index.ts';
import { SessionError } from '../domain/session-error.ts';
import type {
  PackageSaleRequestTransaction,
  PackageSaleRequestTransactions,
} from '../ports/package-sale-request.port.ts';
import type { SessionWriteContext } from '../ports/service-session-transactions.port.ts';
import { discountLimit } from './discount-limit.adapter.ts';
import { insertPendingPackageSale } from './package-sale-request-records.ts';
import { cleanSessionWrite } from './session-recovery-proof.ts';

const OPERATION = 'sell-package';

export function createPackageSaleRequestTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): PackageSaleRequestTransactions {
  return {
    run: async (context, work) => {
      try {
        return await database.withTenant(
          context.companyId,
          (tx) => work(packageSaleRequestTransaction(tx, context, ids)),
          { userId: context.userId },
        );
      } catch (error) {
        return mapPackageSaleRequestError(error);
      }
    },
  };
}

function packageSaleRequestTransaction(
  tx: Tx,
  context: SessionWriteContext,
  ids: IdGenerator,
): PackageSaleRequestTransaction {
  return {
    access: {
      lock: () => lockPackageSaleAccess(tx, context.companyId),
      read: async (at) => {
        const facts = await readPackageSaleAccess(
          tx,
          context.companyId,
          context.userId,
          context.businessId,
          context.branchId,
          at,
        );
        const membershipIds = facts.eligible.map((actor) => actor.membership_id);
        return {
          record: membershipIds.length > 0,
          denied: facts.denied,
          feature: facts.feature,
          membership_ids: membershipIds,
        };
      },
    },
    discountLimit: discountLimit(tx, context.companyId, context.businessId),
    insertPending: (request) => insertPendingPackageSale(tx, request),
    publishRequested: (requestId) =>
      appendOutboxEvent(tx, ids.newId(), {
        aggregateType: 'package_sale_request',
        aggregateId: requestId,
        eventType: 'PackageSaleRequested',
        payload: { sale_request_id: requestId },
      }),
    idempotent: (handler) => claimPackageSaleRequest(tx, context, handler),
  };
}

async function claimPackageSaleRequest<T>(
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
    async () => ({ status: 202, body: await handler() }),
  );
  return { body: result.body as T, replayed: result.replayed };
}

function mapPackageSaleRequestError(error: unknown): never {
  if (error instanceof SessionError) throw error;
  if (error instanceof IdempotencyKeyReusedError) {
    throw new SessionError('IDEMPOTENCY_KEY_REUSED');
  }
  cleanSessionWrite(error);
}
