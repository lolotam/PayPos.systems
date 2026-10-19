import { identityCapability } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export const IDENTITY_CAPABILITY_ACCESS = Symbol('IDENTITY_CAPABILITY_ACCESS');

/** منفذ القرار بجوار الاستعلام حتى لا يعتمد مسار المعاينة على ports/ أو use-cases/. */
export interface IdentityCapabilityAccess {
  /** بيعيد قرار manage:business-identity:business على النشاط من غير أقفال. */
  recheck(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<'FORBIDDEN' | null>;
}

export function deniedIdentityCapability() {
  return identityCapability.parse({ can_manage_identity: false });
}

export function identityCapabilityBusinessStatement(companyId: string, businessId: string) {
  // شاشة هوية النشاط
  return sql`SELECT id FROM businesses
    WHERE company_id=${companyId} AND id=${businessId}
      AND EXISTS (SELECT 1 FROM companies WHERE id=${companyId} AND deleted_at IS NULL)`;
}

export async function readIdentityCapability(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  access: IdentityCapabilityAccess,
) {
  const [business] = await tx.execute<{ id: string }>(
    identityCapabilityBusinessStatement(companyId, businessId),
  );
  if (business === undefined) return deniedIdentityCapability();
  const decision = await access.recheck(tx, companyId, userId, businessId);
  return identityCapability.parse({ can_manage_identity: decision === null });
}
