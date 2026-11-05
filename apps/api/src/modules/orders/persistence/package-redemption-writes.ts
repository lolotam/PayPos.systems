import type { Tx } from '@pospay/db';
import { parseMoney } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import type {
  PackageRedemptionPair,
  PackageRedemptionPort,
  PackageRedemptionSlot,
  PackageRedemptionSnapshot,
  PackageRedemptionWrite,
} from '../ports/package-redemption.port.ts';
import {
  lockPackageRedemptionComponents,
  readPackageRedemptionFreeSlots,
  type PackageRedemptionSnapshot as LockedSnapshot,
} from './package-redemption-read.ts';

/**
 * يبني منفذ الاسترداد على معاملة الزيارة المفتوحة.
 * القفل على المكوّن يسبق قراءة الجلسات الحرة، والجلسة المختارة تُقفل بصفها قبل الاستهلاك.
 *
 * @param tx معاملة الزيارة المفتوحة
 * @param scope نطاق الشركة والنشاط الذي تعمل فيه الزيارة
 * @returns منفذ الاسترداد مربوطاً بالمعاملة
 */
export function createPackageRedemptionPort(tx: Tx, scope: { companyId: string; businessId: string }): PackageRedemptionPort {
  const locked = new Map<string, LockedSnapshot>();
  return {
    lock: async (customer_id: string, pairs: readonly PackageRedemptionPair[]) => {
      const rows = await lockPackageRedemptionComponents(tx, { ...scope, customerId: customer_id },
        pairs.map((pair) => ({ entitlementId: pair.entitlement_id, serviceId: pair.service_id })));
      if (rows === null) return null;
      for (const row of rows) locked.set(row.componentId, row);
      return rows.map((row): PackageRedemptionSnapshot => ({
        entitlement_id: row.entitlementId,
        component_id: row.componentId,
        service_id: row.serviceId,
        expires_on: row.expiresOn,
        sold_at: row.soldAt,
      }));
    },
    freeSlots: async (component_id: string, count: number) => {
      const snapshot = locked.get(component_id);
      if (snapshot === undefined) return [];
      const slots = await readPackageRedemptionFreeSlots(tx, snapshot, count);
      if (slots === null) return [];
      return slots.map((slot): PackageRedemptionSlot => ({ id: slot.id, ordinal: slot.ordinal, unit_value: slot.unitValue }));
    },
    lockSlot: async (slot_id: string) => {
      const rows = await tx.execute<{ id: string; ordinal: number; unitValue: string }>(sql`
        SELECT id, ordinal, unit_value::text AS "unitValue"
        FROM package_session_slots
        WHERE company_id = ${scope.companyId}::uuid
          AND business_id = ${scope.businessId}::uuid
          AND id = ${slot_id}::uuid AND state = 'FREE'
        FOR UPDATE`);
      const row = rows[0];
      if (row === undefined) return null;
      return { id: row.id, ordinal: row.ordinal, unit_value: parseMoney(row.unitValue) };
    },
    writeRedemptions: async (rows: readonly PackageRedemptionWrite[]) => {
      for (const row of rows) {
        await tx.execute(sql`
          INSERT INTO package_redemptions
            (company_id, id, business_id, entitlement_id, component_id, slot_id, line_id, redeemed_at, recorded_by, recorded_by_membership_id)
          VALUES (${scope.companyId}::uuid, ${row.redemption_id}::uuid, ${scope.businessId}::uuid, ${row.entitlement_id}::uuid,
            ${row.component_id}::uuid, ${row.slot_id}::uuid, ${row.line_id}::uuid, ${row.redeemed_at.toISOString()}::timestamptz,
            ${row.recorded_by}::uuid, ${row.recorded_by_membership_id}::uuid)`);
      }
    },
    markSlotsUsed: async (rows: readonly { slot_id: string; redemption_id: string }[]) => {
      for (const row of rows) {
        await tx.execute(sql`
          UPDATE package_session_slots
          SET state = 'USED', current_redemption_id = ${row.redemption_id}::uuid
          WHERE company_id = ${scope.companyId}::uuid
            AND business_id = ${scope.businessId}::uuid
            AND id = ${row.slot_id}::uuid AND state = 'FREE'`);
      }
    },
  };
}
