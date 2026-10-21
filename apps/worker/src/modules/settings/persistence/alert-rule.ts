import type { Tx } from '@pospay/db';
import {
  effectiveAlertRule,
  type AlertKind,
  type AlertRuleSettings,
  type EffectiveAlertRule,
} from '@pospay/domain';
import { sql } from 'drizzle-orm';

type Row = {
  branch_id: string | null;
  kind: AlertKind | null;
  enabled: boolean;
  recipient_roles: AlertRuleSettings['recipientRoles'];
  channels: AlertRuleSettings['channels'];
  delay_minutes: number | null;
  lead_minutes: number | null;
  alerts_enabled: boolean | null;
};

const settingsOf = (row: Row): AlertRuleSettings => ({
  enabled: row.enabled,
  recipientRoles: row.recipient_roles,
  channels: row.channels,
  delayMinutes: row.delay_minutes,
  leadMinutes: row.lead_minutes,
});

/**
 * القاعدة الفعلية لنوع تنبيه واحد للمهام اللي بتشتغل من غير جلسة، على معاملة المستدعي؛ نفس قراية API settings
 * (spec 060 D-B14). قاعدة الفرع لو موجودة، وإلا قاعدة النشاط، وإلا الافتراضي، والمفتاح العام مطبّق.
 *
 * @param tx معاملة الشركة بتاعة المُرسِل
 * @param companyId الشركة
 * @param scope نشاط الحدث وفرعه (null لنوع من غير فرع)
 * @param scope.businessId نشاط الحدث
 * @param scope.branchId فرع الحدث أو null
 * @param kind نوع التنبيه
 * @returns القاعدة الفعلية؛ مقفولة = مفيش مستلمين ولا قنوات
 */
export async function alertRule(
  tx: Tx,
  companyId: string,
  scope: { businessId: string; branchId: string | null },
  kind: AlertKind,
): Promise<EffectiveAlertRule> {
  const rows = await tx.execute<Row>(sql`
    SELECT r.branch_id, r.kind, r.enabled, r.recipient_roles, r.channels, r.delay_minutes, r.lead_minutes,
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
    business === undefined ? null : settingsOf(business),
    branch === undefined ? null : settingsOf(branch),
    rows[0]?.alerts_enabled ?? null,
  );
}
