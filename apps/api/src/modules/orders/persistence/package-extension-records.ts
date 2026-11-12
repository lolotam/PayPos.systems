import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type {
  LockedPackageEntitlement,
  PackageExtensionInsert,
} from '../ports/package-extension.port.ts';

type PackageExtensionScope = Readonly<{
  companyId: string;
  businessId: string;
  branchId: string;
}>;

export async function lockPackageEntitlement(
  tx: Tx,
  scope: PackageExtensionScope,
  entitlementId: string,
): Promise<LockedPackageEntitlement | null> {
  const [row] = await tx.execute<LockedPackageEntitlement>(sql`
    SELECT expires_on::text AS "expires_on"
    FROM package_entitlements
    WHERE company_id = ${scope.companyId}::uuid
      AND business_id = ${scope.businessId}::uuid
      AND id = ${entitlementId}::uuid
    FOR UPDATE`);
  return row ?? null;
}

export async function insertPackageExtension(
  tx: Tx,
  scope: PackageExtensionScope,
  extension: PackageExtensionInsert,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO package_extensions
      (company_id, id, business_id, entitlement_id, branch_id, previous_expires_on,
        new_expires_on, reason, extended_by, extended_by_membership_id, extended_at)
    VALUES
      (${scope.companyId}::uuid, ${extension.id}::uuid, ${scope.businessId}::uuid,
        ${extension.entitlement_id}::uuid, ${scope.branchId}::uuid,
        ${extension.previous_expires_on}::date, ${extension.new_expires_on}::date,
        ${extension.reason}, ${extension.extended_by}::uuid,
        ${extension.extended_by_membership_id}::uuid, ${extension.extended_at.toISOString()}::timestamptz)`);
}

export async function updatePackageExpiry(
  tx: Tx,
  scope: PackageExtensionScope,
  entitlementId: string,
  expectedExpiresOn: string,
  newExpiresOn: string,
): Promise<boolean> {
  const updated = await tx.execute<{ id: string }>(sql`
    UPDATE package_entitlements
    SET expires_on = ${newExpiresOn}::date
    WHERE company_id = ${scope.companyId}::uuid
      AND business_id = ${scope.businessId}::uuid
      AND id = ${entitlementId}::uuid
      AND expires_on = ${expectedExpiresOn}::date
    RETURNING id`);
  return updated.length === 1;
}
