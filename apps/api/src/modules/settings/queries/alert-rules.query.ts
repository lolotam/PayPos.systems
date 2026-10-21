import type { AlertKindCode, AlertRules } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

type AlertRuleView = AlertRules['rules'][number];
type Role = AlertRuleView['recipient_roles'][number];
type Channel = AlertRuleView['channels'][number];

type RuleRow = {
  branch_id: string | null;
  kind: AlertKindCode;
  enabled: boolean;
  recipient_roles: readonly Role[];
  channels: readonly Channel[];
  delay_minutes: number | null;
  lead_minutes: number | null;
  revision: number;
};

/** قاعدة مخزنة لنوع واحد، ومعاها النطاق اللي اتخزنت فيه. */
export interface StoredAlertRuleRow {
  readonly branchId: string | null;
  readonly kind: AlertKindCode;
  readonly enabled: boolean;
  readonly recipientRoles: readonly Role[];
  readonly channels: readonly Channel[];
  readonly delayMinutes: number | null;
  readonly leadMinutes: number | null;
  readonly revision: number;
}

/** كل اللي مخزن: المفتاح العام وقواعد النشاط وقواعد الفرع. */
export interface StoredAlertRules {
  readonly alertsEnabled: boolean | null;
  readonly rules: readonly StoredAlertRuleRow[];
}

// شاشة «التنبيهات» (62-4): القواعد المخزنة والمفتاح العام بس، من غير افتراضي ولا تفسير.
export async function alertRulesQuery(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string | null,
): Promise<StoredAlertRules | null> {
  if (branchId !== null) {
    const [owned] = await tx.execute(sql`SELECT id FROM branches
      WHERE company_id = ${companyId} AND business_id = ${businessId} AND id = ${branchId}`);
    if (owned === undefined) return null;
  } else {
    const [owned] = await tx.execute(sql`SELECT id FROM businesses
      WHERE company_id = ${companyId} AND id = ${businessId}`);
    if (owned === undefined) return null;
  }
  const rows =
    await tx.execute<RuleRow>(sql`SELECT branch_id, kind, enabled, recipient_roles, channels,
      delay_minutes, lead_minutes, revision
    FROM alert_rules WHERE company_id = ${companyId} AND business_id = ${businessId}
      AND (branch_id IS NULL OR branch_id = ${branchId})`);
  const [master] = await tx.execute<{ alerts_enabled: boolean | null }>(sql`SELECT alerts_enabled
    FROM business_settings WHERE company_id = ${companyId} AND business_id = ${businessId}`);
  return {
    alertsEnabled: master?.alerts_enabled ?? null,
    rules: rows.map((row) => ({
      branchId: row.branch_id,
      kind: row.kind,
      enabled: row.enabled,
      recipientRoles: row.recipient_roles,
      channels: row.channels,
      delayMinutes: row.delay_minutes,
      leadMinutes: row.lead_minutes,
      revision: row.revision,
    })),
  };
}
