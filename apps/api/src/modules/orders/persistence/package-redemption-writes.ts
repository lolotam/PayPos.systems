import type { Tx } from '@pospay/db';
import { parseMoney } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import { SessionError } from '../domain/session-error.ts';
import type {
  PackageRedemptionPair,
  PackageRedemptionPort,
  PackageRedemptionSlot,
  PackageRedemptionSnapshot,
  PackageRedemptionWrite,
} from '../ports/package-redemption.port.ts';
import {
  lockPackageRedemptionComponents,
  type PackageRedemptionSnapshot as LockedSnapshot,
} from './package-redemption-read.ts';

type Scope = { companyId: string; businessId: string };

/**
 * يقفل الجلسات المختارة كلها بجملة واحدة مرتبة بالمعرّف.
 * القاعدة: ترتيب القفل ثابت لكل الكاتبين، فلا ينتظر البات بعضها بعضاً.
 * القفل ده متعمّد بعد قفل المكوّن: قفل المكوّن هو نقطة التسلسل الحقيقية، وقفل الجلسة فحص
 * دفاعي يجعل «أقل جلسة حرة تحت قفل صف» نصاً مطابقاً، ويعيد التأكد أن الجلسة ما زالت FREE.
 *
 * @param tx معاملة الزيارة المفتوحة
 * @param scope نطاق الشركة والنشاط
 * @param slot_ids صفوف الجلسات المختارة
 * @returns الجلسات المقفولة، والفاردة منها لم تعد حرة
 */
async function lockSlots(tx: Tx, scope: Scope, slot_ids: readonly string[]): Promise<PackageRedemptionSlot[]> {
  if (slot_ids.length === 0) return [];
  const ids = sql.join(slot_ids.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = await tx.execute<{ id: string; ordinal: number; unitValue: string }>(sql`
    SELECT id, ordinal, unit_value::text AS "unitValue"
    FROM package_session_slots
    WHERE company_id = ${scope.companyId}::uuid
      AND business_id = ${scope.businessId}::uuid
      AND id IN (${ids}) AND state = 'FREE'
    ORDER BY id
    FOR UPDATE`);
  return rows.map((row): PackageRedemptionSlot => ({ id: row.id, ordinal: row.ordinal, unit_value: parseMoney(row.unitValue) }));
}

/**
 * يكتب صفوف الاسترداد كلها بجملة واحدة، فتبقى الزيارة كلها بكتابة واحدة.
 *
 * @param tx معاملة الزيارة المفتوحة
 * @param scope نطاق الشركة والنشاط
 * @param rows صفوف الاسترداد لكل سطر مسترد
 * @returns لا شيء
 */
async function writeRedemptions(tx: Tx, scope: Scope, rows: readonly PackageRedemptionWrite[]): Promise<void> {
  if (rows.length === 0) return;
  const values = sql.join(rows.map((row) => sql`(
    ${scope.companyId}::uuid, ${row.redemption_id}::uuid, ${scope.businessId}::uuid, ${row.entitlement_id}::uuid,
    ${row.component_id}::uuid, ${row.slot_id}::uuid, ${row.line_id}::uuid, ${row.redeemed_at.toISOString()}::timestamptz,
    ${row.recorded_by}::uuid, ${row.recorded_by_membership_id}::uuid)`), sql`, `);
  await tx.execute(sql`
    INSERT INTO package_redemptions
      (company_id, id, business_id, entitlement_id, component_id, slot_id, line_id, redeemed_at, recorded_by, recorded_by_membership_id)
    VALUES ${values}`);
}

/**
 * ينقل الجلسات من FREE إلى USED ويشير كل جلسة إلى صف الاسترداد الخاص بها، بجملة واحدة.
 *
 * @param tx معاملة الزيارة المفتوحة
 * @param scope نطاق الشركة والنشاط
 * @param rows الجلسة وصف الاسترداد الخاص بها
 * @returns لا شيء
 */
async function markSlotsUsed(tx: Tx, scope: Scope, rows: readonly { slot_id: string; redemption_id: string }[]): Promise<void> {
  if (rows.length === 0) return;
  const values = sql.join(rows.map((row) => sql`(${row.slot_id}::uuid, ${row.redemption_id}::uuid)`), sql`, `);
  const updated = await tx.execute<{ id: string }>(sql`
    UPDATE package_session_slots s
    SET state = 'USED', current_redemption_id = v.redemption_id
    FROM (VALUES ${values}) AS v(slot_id, redemption_id)
    WHERE s.company_id = ${scope.companyId}::uuid
      AND s.business_id = ${scope.businessId}::uuid
      AND s.id = v.slot_id AND s.state = 'FREE'
    RETURNING s.id`);
  // جلسة ما اتنقلتش معناها حد آخر خطفها، فالطلب كله يتراجع بدل ما يبقى نصف استرداد.
  if (updated.length !== rows.length) throw new SessionError('PACKAGE_NO_FREE_SESSION');
}

/**
 * يبني منفذ الاسترداد على معاملة الزيارة المفتوحة.
 * القفل على المكوّن يسبق قراءة الجلسات الحرة، والجلسات المختارة تُقفل بصفوفها قبل الاستهلاك.
 *
 * @param tx معاملة الزيارة المفتوحة
 * @param scope نطاق الشركة والنشاط الذي تعمل فيه الزيارة
 * @returns منفذ الاسترداد مربوطاً بالمعاملة
 */
export function createPackageRedemptionPort(tx: Tx, scope: Scope): PackageRedemptionPort {
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
    freeSlots: async (requests) => {
      const result = new Map<string, PackageRedemptionSlot[]>();
      if (requests.length === 0) return result;
      const values = sql.join(requests.map(({ component_id, count }) => {
        const snapshot = locked.get(component_id);
        if (snapshot === undefined) throw new SessionError('PACKAGE_NOT_USABLE_HERE');
        return sql`(${snapshot.entitlementId}::uuid, ${component_id}::uuid, ${count}::integer)`;
      }), sql`, `);
      const rows = await tx.execute<{ component_id: string; id: string; ordinal: number; unitValue: string }>(sql`
        SELECT v.component_id, s.id, s.ordinal, s.unit_value::text AS "unitValue"
        FROM (VALUES ${values}) AS v(entitlement_id, component_id, wanted)
        CROSS JOIN LATERAL (
          SELECT id, ordinal, unit_value FROM package_session_slots
          WHERE company_id = ${scope.companyId}::uuid AND business_id = ${scope.businessId}::uuid
            AND entitlement_id = v.entitlement_id AND component_id = v.component_id AND state = 'FREE'
          ORDER BY ordinal LIMIT v.wanted
        ) s ORDER BY v.component_id, s.ordinal`);
      for (const row of rows) {
        const slots = result.get(row.component_id) ?? [];
        slots.push({ id: row.id, ordinal: row.ordinal, unit_value: parseMoney(row.unitValue) });
        result.set(row.component_id, slots);
      }
      return result;
    },
    lockSlots: (slot_ids) => lockSlots(tx, scope, slot_ids),
    writeRedemptions: (rows) => writeRedemptions(tx, scope, rows),
    markSlotsUsed: (rows) => markSlotsUsed(tx, scope, rows),
  };
}
