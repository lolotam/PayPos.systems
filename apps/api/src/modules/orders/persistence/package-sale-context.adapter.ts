import { packageSaleSellerOptionPage, type SessionPerformerOptionsQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { readPackageSaleAccess } from '../../identity/index.ts';
import { readSessionPerformerOptions } from '../../staff/index.ts';
import { packageSalePlace } from '../../tenancy/index.ts';

type PackageSaleScope = {
  companyId: string;
  userId: string;
  businessId: string;
  branchId: string;
};

export async function place(tx: Tx, scope: PackageSaleScope) {
  return packageSalePlace(tx, scope.companyId, scope.businessId, scope.branchId);
}

export async function access(tx: Tx, scope: PackageSaleScope, at: Date) {
  const access = await readPackageSaleAccess(
    tx,
    scope.companyId,
    scope.userId,
    scope.businessId,
    scope.branchId,
    at,
  );
  return {
    ...access,
    eligible: access.eligible.map(({ membership_id, scope_type, scope_id }) => ({
      membership_id,
      scope_type,
      scope_id,
    })),
  };
}

export async function options(
  tx: Tx,
  scope: PackageSaleScope,
  query: SessionPerformerOptionsQuery,
) {
  const page = await readSessionPerformerOptions(
    tx,
    scope.companyId,
    scope.businessId,
    scope.branchId,
    query,
    (instant) => instant,
  );
  return packageSaleSellerOptionPage.parse({
    sale_anchor: query.occurred_at,
    items: page.items.map(({ id, name_ar, name_en, employee_number }) => ({
      id,
      name_ar,
      name_en,
      employee_number,
    })),
    next_cursor: page.next_cursor,
  });
}
