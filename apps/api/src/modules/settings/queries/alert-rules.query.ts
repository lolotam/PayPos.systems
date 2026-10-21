import type { AlertRules } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { ALERT_KIND_DEFINITIONS, ALERT_KINDS, type FixedAlertRecipient } from '@pospay/domain';

import { readAlertsEnabled, readStoredAlertRules } from '../persistence/alert-rules-store.ts';

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
  const business = await readStoredAlertRules(tx, companyId, { businessId, branchId: null });
  const branch =
    branchId === null
      ? new Map<never, never>()
      : await readStoredAlertRules(tx, companyId, { businessId, branchId });
  const alertsEnabled = await readAlertsEnabled(tx, companyId, businessId);
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
