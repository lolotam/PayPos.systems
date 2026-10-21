import type { Tx } from '@pospay/db';
import { effectiveAlertRule, type AlertKind, type EffectiveAlertRule } from '@pospay/domain';
import { sql } from 'drizzle-orm';

import { toStoredAlertRule } from './alert-rules-store.ts';

type Row = Parameters<typeof toStoredAlertRule>[0] & { branch_id: string | null };

/**
 * القاعدة الفعلية لنوع واحد في نطاق حدث، بالمفتاح العام مطبّق (spec 060 D-B13)، على معاملة المستدعي.
 * ده المزوّد اللي AlertRulesPort بتاع كل موديول مستهلك بيتربط بيه: قاعدة الفرع لو الحدث ليه فرع وفيه قاعدة، وإلا قاعدة
 * النشاط، وإلا الافتراضي. نوع من غير فرع (الكشوفات، المستندات) بيبعت branchId = null.
 *
 * @param tx        معاملة الشركة بتاعة المُرسِل
 * @param companyId الشركة
 * @param scope     نشاط الحدث وفرعه (أو null)
 * @param scope.businessId نشاط الحدث
 * @param scope.branchId   فرع الحدث أو null
 * @param kind      نوع التنبيه
 * @returns القاعدة الفعلية؛ مقفولة = مفيش مستلمين ولا قنوات
 */
export async function readAlertRule(
  tx: Tx,
  companyId: string,
  scope: { businessId: string; branchId: string | null },
  kind: AlertKind,
): Promise<EffectiveAlertRule> {
  const rows = await tx.execute<Row & { alerts_enabled: boolean | null }>(sql`
    SELECT r.id, r.branch_id, r.kind, r.enabled, r.recipient_roles, r.channels, r.delay_minutes, r.lead_minutes, r.revision,
      (SELECT s.alerts_enabled FROM business_settings s
        WHERE s.company_id = ${companyId} AND s.business_id = ${scope.businessId}) AS alerts_enabled
    FROM (SELECT 1) AS one
    LEFT JOIN alert_rules r ON r.company_id = ${companyId} AND r.business_id = ${scope.businessId}
      AND r.kind = ${kind} AND (r.branch_id IS NULL OR r.branch_id = ${scope.branchId})`);
  const stored = rows.filter((row) => row.kind !== null);
  const business = stored.find((row) => row.branch_id === null);
  const branch = stored.find((row) => row.branch_id !== null);
  return effectiveAlertRule(
    kind,
    business === undefined ? null : toStoredAlertRule(business),
    branch === undefined ? null : toStoredAlertRule(branch),
    rows[0]?.alerts_enabled ?? null,
  );
}
