import {
  OWNER_ROLE_ID,
  runIdempotent,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type {
  OnboardingScope,
  OnboardingTransactions,
  Transaction,
} from '../ports/onboarding.port.ts';

function scopeFor(tx: Tx, companyId: string, ids: IdGenerator): OnboardingScope {
  return {
    tx: tx as unknown as Transaction,
    companyId,
    ...transactionWriters(tx, ids),
    planExists: async (planId) =>
      (await tx.execute(sql`SELECT 1 FROM plans WHERE id = ${planId}`)).length === 1,
    addOwnerMembership: async (membershipId, userId) => {
      await tx.execute(sql`
        INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
        VALUES (${companyId}, ${membershipId}, ${userId}, ${OWNER_ROLE_ID}, 'global', 'COMPANY', ${companyId})`);
    },
  };
}

/**
 * @param db  the tenant wrappers
 * @param ids the UUID v7 generator for audit and outbox rows
 * @returns withNewTenant + a USER-scoped idempotency claim, around the onboarding work
 */
export function createOnboardingTransactions(
  db: TenantWrappers,
  ids: IdGenerator,
): OnboardingTransactions {
  return {
    run: (userId, idempotency, work) =>
      db.withNewTenant(userId, (tx, companyId) =>
        runIdempotent(tx, { scope: 'USER', operation: 'onboard-company', ...idempotency }, () =>
          work(scopeFor(tx, companyId, ids)),
        ),
      ),
  };
}
