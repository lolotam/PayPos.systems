import type { AlertRules } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import {
  ALERT_KIND_DEFINITIONS,
  ALERT_KINDS,
  type AlertKind,
  type AlertRuleSettings,
  type FixedAlertRecipient,
} from '@pospay/domain';

type RuleRow = {
  branch_id: string | null;
  kind: AlertKind;
  enabled: boolean;
  recipient_roles: AlertRuleSettings['recipientRoles'];
  channels: AlertRuleSettings['channels'];
  delay_minutes: number | null;
  lead_minutes: number | null;
};
const settingsOf = (row: RuleRow): AlertRuleSettings => ({
  enabled: row.enabled,
  recipientRoles: row.recipient_roles,
  channels: row.channels,
  delayMinutes: row.delay_minutes,
  leadMinutes: row.lead_minutes,
});

const fixedView = (recipient: FixedAlertRecipient) => ({
  selector: recipient.selector,
  permission: recipient.selector === 'PERMISSION_HOLDERS' ? recipient.permission : null,
  who: recipient.selector === 'CONTEXT' ? recipient.who : null,
});

// شاشة «التنبيهات» (62-4): كل نوع بقيمته المخزنة أو الافتراضي، من غير المفتاح العام اللي بيرجع لوحده.
export async function alertRulesQuery(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string | null,
): Promise<AlertRules | null> {
  if (branchId !== null) {
    const [owned] = await tx.execute(sql`SELECT id FROM branches
      WHERE company_id = ${companyId} AND business_id = ${businessId} AND id = ${branchId}`);
    if (owned === undefined) return null;
  }
  const rows = await tx.execute<RuleRow>(sql`SELECT branch_id, kind, enabled, recipient_roles, channels,
      delay_minutes, lead_minutes
    FROM alert_rules WHERE company_id = ${companyId} AND business_id = ${businessId}
      AND (branch_id IS NULL OR branch_id = ${branchId})`);
  const business = new Map(rows.filter((r) => r.branch_id === null).map((r) => [r.kind, settingsOf(r)]));
  const branch = new Map(rows.filter((r) => r.branch_id !== null).map((r) => [r.kind, settingsOf(r)]));
  const [master] = await tx.execute<{ alerts_enabled: boolean | null }>(sql`SELECT alerts_enabled
    FROM business_settings WHERE company_id = ${companyId} AND business_id = ${businessId}`);
  const alertsEnabled = master?.alerts_enabled ?? null;
  return {
    business_id: businessId,
    branch_id: branchId,
    alerts_enabled: alertsEnabled ?? true,
    rules: ALERT_KINDS.map((kind) => {
      const own = branch.get(kind);
      const inherited = business.get(kind);
      const rule = own ?? inherited ?? ALERT_KIND_DEFINITIONS[kind].defaults;
      return {
        kind,
        source: own !== undefined ? 'BRANCH' : inherited !== undefined ? 'BUSINESS' : 'DEFAULT',
        enabled: rule.enabled,
        recipient_roles: [...rule.recipientRoles],
        channels: [...rule.channels],
        delay_minutes: rule.delayMinutes,
        lead_minutes: rule.leadMinutes,
        fixed_recipients: ALERT_KIND_DEFINITIONS[kind].fixedRecipients.map(fixedView),
      };
    }),
  };
}
