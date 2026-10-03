import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type { OverrideTerms } from '../domain/permission-edit.ts';
import type {
  DiscountLimitScope,
  DiscountLimitTransactions,
} from '../ports/discount-limit.port.ts';
import { permissionEditorContext } from './permission-editor-context.ts';

async function context(tx: Tx, companyId: string, userId: string, membershipId: string) {
  const terms: OverrideTerms = {
    permission_code: 'manage:discounts:company',
    effect: 'ALLOW',
    scope_type: 'COMPANY',
    scope_id: companyId,
    reason: '',
    expires_at: null,
  };
  const locked = await permissionEditorContext(tx, companyId, userId, membershipId, terms);
  if (locked.membership === null) return locked;
  return permissionEditorContext(tx, companyId, userId, membershipId, {
    ...terms,
    scope_type: locked.membership.scopeType,
    scope_id: locked.membership.scopeId,
  });
}

function scopeFor(tx: Tx, companyId: string, userId: string, ids: IdGenerator): DiscountLimitScope {
  return {
    audit: transactionWriters(tx, ids).audit,
    context: (membershipId) => context(tx, companyId, userId, membershipId),
    current: async (membershipId) => {
      const [row] = await tx.execute<{
        limit_bps: number | null;
      }>(sql`SELECT limit_bps FROM memberships
        WHERE company_id = ${companyId} AND id = ${membershipId}`);
      if (row === undefined) throw new Error('Locked membership missing');
      return row.limit_bps;
    },
    save: async (membershipId, limitBps) => {
      await tx.execute(sql`UPDATE memberships SET limit_bps = ${limitBps}
        WHERE company_id = ${companyId} AND id = ${membershipId}`);
    },
  };
}

export function createDiscountLimitTransactions(
  db: TenantWrappers,
  ids: IdGenerator,
): DiscountLimitTransactions {
  return {
    run: (companyId, userId, work) =>
      db.withTenant(companyId, (tx) => work(scopeFor(tx, companyId, userId, ids)), { userId }),
  };
}
