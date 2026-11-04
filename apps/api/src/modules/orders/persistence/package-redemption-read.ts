import type { Tx } from '@pospay/db';
import { parseMoney, type Money } from '@pospay/domain';
import { sql } from 'drizzle-orm';

export type PackageRedemptionScope = Readonly<{
  companyId: string;
  businessId: string;
  customerId: string;
}>;

export type PackageRedemptionPair = Readonly<{
  entitlementId: string;
  serviceId: string;
}>;

export type PackageRedemptionSnapshot = Readonly<
  PackageRedemptionScope & {
    entitlementId: string;
    componentId: string;
    serviceId: string;
    expiresOn: string;
    soldAt: Date | null;
    provenance: 'SOLD' | 'IMPORTED';
  }
>;

export type PackageRedemptionSlot = Readonly<{
  id: string;
  ordinal: number;
  unitValue: Money;
}>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const locked = new WeakMap<Tx, WeakSet<PackageRedemptionSnapshot>>();

function facts(scope: PackageRedemptionScope, pairs: readonly PackageRedemptionPair[]) {
  const requested = sql.join(
    pairs.map(
      (pair, index) => sql`(
    ${index}::integer, ${pair.entitlementId}::uuid, ${pair.serviceId}::uuid
  )`,
    ),
    sql`, `,
  );
  return sql`
    WITH requested(position, entitlement_id, service_id) AS (VALUES ${requested})
    SELECT r.position, e.company_id AS "companyId", e.business_id AS "businessId",
      e.customer_id AS "customerId", e.id AS "entitlementId", c.id AS "componentId",
      c.service_id AS "serviceId", e.expires_on::text AS "expiresOn",
      e.sold_at AS "soldAt", e.provenance
    FROM requested r
    JOIN package_entitlements e ON e.id = r.entitlement_id
      AND e.company_id = ${scope.companyId}::uuid
      AND e.business_id = ${scope.businessId}::uuid
      AND e.customer_id = ${scope.customerId}::uuid
    JOIN package_components c ON c.company_id = e.company_id
      AND c.business_id = e.business_id AND c.entitlement_id = e.id
      AND c.service_id = r.service_id
    ORDER BY r.position`;
}

/**
 * القفل يخص معاملة المستدعي؛ فحص الإذن وقفل الزيارة يسبقان هذه القراءة.
 * إعادة القراءة بعد الانتظار تمنع إرجاع تاريخ انتهاء سابق للقفل.
 *
 * @param tx معاملة الزيارة المفتوحة
 * @param scope نطاق العميل والنشاط الذي تحقّق منه المستدعي
 * @param pairs الاستحقاقات والخدمات المختارة بترتيب الطلب
 * @returns لقطات مقفلة أو null للدفعة كلها عند أي عدم تطابق
 */
export async function lockPackageRedemptionComponents(
  tx: Tx,
  scope: PackageRedemptionScope,
  pairs: readonly PackageRedemptionPair[],
): Promise<readonly PackageRedemptionSnapshot[] | null> {
  if (pairs.length < 1 || pairs.length > 20) return null;
  const ids = [
    scope.companyId,
    scope.businessId,
    scope.customerId,
    ...pairs.flatMap((pair) => [pair.entitlementId, pair.serviceId]),
  ];
  if (!ids.every((id) => uuid.test(id))) return null;
  const initial = await tx.execute<PackageRedemptionSnapshot>(facts(scope, pairs));
  if (initial.length !== pairs.length) return null;
  const componentIds = [...new Set(initial.map((row) => row.componentId))].sort();
  const acquired = await tx.execute<{ id: string }>(sql`
    SELECT c.id FROM package_components c
    WHERE c.company_id = ${scope.companyId}::uuid
      AND c.business_id = ${scope.businessId}::uuid
      AND c.id IN (${sql.join(
        componentIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
    ORDER BY c.id FOR UPDATE OF c`);
  if (acquired.length !== componentIds.length) return null;
  const rows = await tx.execute<PackageRedemptionSnapshot>(facts(scope, pairs));
  if (rows.length !== pairs.length) return null;
  const snapshots = rows.map((row) =>
    Object.freeze({
      companyId: row.companyId,
      businessId: row.businessId,
      customerId: row.customerId,
      entitlementId: row.entitlementId,
      componentId: row.componentId,
      serviceId: row.serviceId,
      expiresOn: row.expiresOn,
      soldAt: row.soldAt === null ? null : new Date(row.soldAt),
      provenance: row.provenance,
    }),
  );
  const held = locked.get(tx) ?? new WeakSet<PackageRedemptionSnapshot>();
  for (const snapshot of snapshots) held.add(snapshot);
  locked.set(tx, held);
  return Object.freeze(snapshots);
}

/**
 * القراءة لا تحجز ولا تستهلك جلسة؛ المستدعي يكتب الاستهلاك داخل نفس المعاملة.
 * تكرار القراءة قبل الكتابة يرجع نفس الجلسات، لذلك يجمع المستدعي العدد لكل مكوّن.
 *
 * @param tx نفس المعاملة التي تحمل القفل
 * @param component لقطة أعادتها دالة القفل لهذه المعاملة
 * @param count عدد محدود من 1 إلى 20
 * @returns أقل الأرقام الحرة وقيمها المخزنة، أو null لو الطلب غير صالح
 */
export async function readPackageRedemptionFreeSlots(
  tx: Tx,
  component: PackageRedemptionSnapshot,
  count: number,
): Promise<readonly PackageRedemptionSlot[] | null> {
  if (!Number.isInteger(count) || count < 1 || count > 20) return null;
  if (!locked.get(tx)?.has(component)) return null;
  const rows = await tx.execute<{ id: string; ordinal: number; unitValue: string }>(sql`
    SELECT id, ordinal, unit_value::text AS "unitValue"
    FROM package_session_slots
    WHERE company_id = ${component.companyId}::uuid
      AND business_id = ${component.businessId}::uuid
      AND entitlement_id = ${component.entitlementId}::uuid
      AND component_id = ${component.componentId}::uuid AND state = 'FREE'
    ORDER BY ordinal LIMIT ${count}`);
  return Object.freeze(
    rows.map((row) =>
      Object.freeze({
        id: row.id,
        ordinal: row.ordinal,
        unitValue: parseMoney(row.unitValue),
      }),
    ),
  );
}
