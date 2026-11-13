import type { IdGenerator, Tx } from '@pospay/db';
import { moneyToString, parseMoney, type Money } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import { PackageRuleError } from '../domain/errors.ts';
import type {
  LockedRefundEntitlement,
  LockedRefundSlot,
  PackageRefundInsert,
} from '../ports/package-refund.port.ts';

type PackageRefundScope = Readonly<{
  companyId: string;
  businessId: string;
  branchId: string;
}>;

type EntitlementRow = {
  business_id: string;
  provenance: 'SOLD' | 'IMPORTED';
  expires_on: string;
  refunded_amount: string;
  revision: number;
  price_paid: string;
  sold_branch_id: string | null;
  sold_at: Date | string | null;
  sold_business_date: string | null;
  seller_employee_id: string | null;
};

export async function lockRefundEntitlement(
  tx: Tx,
  scope: PackageRefundScope,
  entitlementId: string,
): Promise<LockedRefundEntitlement | null> {
  const rows = await tx.execute<EntitlementRow>(sql`
    SELECT business_id, provenance, expires_on::text AS "expires_on",
      refunded_amount::text AS "refunded_amount", revision, price_paid::text AS "price_paid",
      sold_branch_id, sold_at, sold_business_date::text AS "sold_business_date", seller_employee_id
    FROM package_entitlements
    WHERE company_id = ${scope.companyId}::uuid
      AND business_id = ${scope.businessId}::uuid
      AND id = ${entitlementId}::uuid
    FOR UPDATE`);
  const row = rows[0];
  return row === undefined ? null : toLockedEntitlement(row);
}

export async function lockRefundComponent(
  tx: Tx,
  scope: PackageRefundScope,
  entitlementId: string,
  componentId: string,
): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(sql`
    SELECT id FROM package_components
    WHERE company_id = ${scope.companyId}::uuid
      AND business_id = ${scope.businessId}::uuid
      AND entitlement_id = ${entitlementId}::uuid
      AND id = ${componentId}::uuid
    FOR UPDATE`);
  return rows.length === 1;
}

export async function lockRefundSlots(
  tx: Tx,
  scope: PackageRefundScope,
  entitlementId: string,
  componentId: string,
): Promise<readonly LockedRefundSlot[]> {
  const rows = await tx.execute<{
    id: string;
    ordinal: number;
    unit_value: string;
    state: LockedRefundSlot['state'];
  }>(sql`
    SELECT id, ordinal, unit_value::text AS "unit_value", state
    FROM package_session_slots
    WHERE company_id = ${scope.companyId}::uuid
      AND business_id = ${scope.businessId}::uuid
      AND entitlement_id = ${entitlementId}::uuid
      AND component_id = ${componentId}::uuid
    ORDER BY id
    FOR UPDATE`);
  return rows.map((row) => ({
    id: row.id,
    ordinal: row.ordinal,
    unitValue: parseMoney(row.unit_value),
    state: row.state,
  }));
}

export async function insertPackageRefund(
  tx: Tx,
  scope: PackageRefundScope,
  refund: PackageRefundInsert,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO package_refunds
      (company_id, id, business_id, entitlement_id, component_id, branch_id, sessions,
        amount, method, reason, refunded_by, refunded_by_membership_id, refunded_at,
        entitlement_revision)
    VALUES
      (${scope.companyId}::uuid, ${refund.id}::uuid, ${scope.businessId}::uuid,
        ${refund.entitlement_id}::uuid, ${refund.component_id}::uuid, ${scope.branchId}::uuid,
        ${refund.sessions}::integer, ${moneyToString(refund.amount)}::numeric, ${refund.method},
        ${refund.reason}, ${refund.refunded_by}::uuid, ${refund.refunded_by_membership_id}::uuid,
        ${refund.refunded_at.toISOString()}::timestamptz, ${refund.entitlement_revision}::integer)`);
}

export async function insertPackageRefundSlots(
  tx: Tx,
  scope: PackageRefundScope,
  ids: IdGenerator,
  refund: PackageRefundInsert,
  slots: readonly LockedRefundSlot[],
): Promise<void> {
  if (slots.length === 0) return;
  const values = sql.join(
    slots.map(
      (slot) => sql`(
      ${scope.companyId}::uuid, ${ids.newId()}::uuid, ${scope.businessId}::uuid, ${refund.id}::uuid,
      ${refund.entitlement_id}::uuid, ${refund.component_id}::uuid, ${slot.id}::uuid,
      ${slot.ordinal}::integer, ${moneyToString(slot.unitValue)}::numeric)`,
    ),
    sql`, `,
  );
  await tx.execute(sql`
    INSERT INTO package_refund_slots
      (company_id, id, business_id, refund_id, entitlement_id, component_id, slot_id, ordinal, unit_value)
    VALUES ${values}`);
}

export async function markPackageSlotsRefunded(
  tx: Tx,
  scope: PackageRefundScope,
  slots: readonly LockedRefundSlot[],
  sessions: number,
): Promise<void> {
  if (slots.length === 0) return;
  const ids = sql.join(
    slots.map((slot) => sql`${slot.id}::uuid`),
    sql`, `,
  );
  const updated = await tx.execute<{ id: string }>(sql`
    UPDATE package_session_slots
    SET state = 'REFUNDED'
    WHERE company_id = ${scope.companyId}::uuid
      AND business_id = ${scope.businessId}::uuid
      AND id IN (${ids}) AND state = 'FREE'
    RETURNING id`);
  // جلسة ما اتنقلتش معناها حد تاني خطفها، فالطلب كله يتراجع بدل ما يبقى نص استرداد.
  if (updated.length !== sessions) throw new PackageRuleError('INSUFFICIENT_SLOTS');
}

export async function updateRefundEntitlement(
  tx: Tx,
  scope: PackageRefundScope,
  entitlementId: string,
  refundedAmount: Money,
  revision: number,
): Promise<boolean> {
  const updated = await tx.execute<{ id: string }>(sql`
    UPDATE package_entitlements
    SET refunded_amount = ${moneyToString(refundedAmount)}::numeric, revision = ${revision}::integer
    WHERE company_id = ${scope.companyId}::uuid
      AND business_id = ${scope.businessId}::uuid
      AND id = ${entitlementId}::uuid
    RETURNING id`);
  return updated.length === 1;
}

function toLockedEntitlement(row: EntitlementRow): LockedRefundEntitlement {
  const base = {
    business_id: row.business_id,
    expires_on: row.expires_on,
    refunded_amount: parseMoney(row.refunded_amount),
    revision: row.revision,
    price_paid: parseMoney(row.price_paid),
  };
  if (row.provenance === 'IMPORTED') return { ...base, provenance: 'IMPORTED' };
  // قيد الشكل بيطلب لقطة البيع مع كل باقة مباعة، فغيابها كسر في القاعدة مش رفض عادي.
  if (
    row.sold_branch_id === null ||
    row.sold_at === null ||
    row.sold_business_date === null ||
    row.seller_employee_id === null
  ) {
    throw new Error('a sold entitlement is missing its sale snapshot');
  }
  return {
    ...base,
    provenance: 'SOLD',
    sold_branch_id: row.sold_branch_id,
    sold_at: new Date(row.sold_at),
    sold_business_date: row.sold_business_date,
    seller_employee_id: row.seller_employee_id,
  };
}
