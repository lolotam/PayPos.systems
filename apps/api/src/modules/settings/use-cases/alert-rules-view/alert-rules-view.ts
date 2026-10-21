import type { AlertRules } from '@pospay/contracts';
import {
  ALERT_KIND_DEFINITIONS,
  ALERT_KINDS,
  resolveAlertRule,
  type FixedAlertRecipient,
} from '@pospay/domain';

import type { AlertRulesSnapshot } from '../../ports/alert-rules.port.ts';

const fixedView = (recipient: FixedAlertRecipient) => ({
  selector: recipient.selector,
  permission: recipient.selector === 'PERMISSION_HOLDERS' ? recipient.permission : null,
  who: recipient.selector === 'CONTEXT' ? recipient.who : null,
});

// بيبني رد شاشة «التنبيهات» (62-4) من اللقطة المخزنة: كل نوع بمصدره وقيمته ورقم نسخته في نطاق العرض.
export function alertRulesView(
  target: { businessId: string; branchId: string | null },
  snapshot: AlertRulesSnapshot,
): AlertRules {
  const business = new Map(
    snapshot.rules.filter((rule) => rule.branchId === null).map((rule) => [rule.kind, rule] as const),
  );
  const branch = new Map(
    snapshot.rules.filter((rule) => rule.branchId !== null).map((rule) => [rule.kind, rule] as const),
  );
  return {
    business_id: target.businessId,
    branch_id: target.branchId,
    alerts_enabled: snapshot.alertsEnabled ?? true,
    rules: ALERT_KINDS.map((kind) => {
      const own = branch.get(kind);
      const inherited = business.get(kind);
      const { source, settings } = resolveAlertRule(kind, inherited ?? null, own ?? null);
      const scopeRule = target.branchId === null ? inherited : own;
      return {
        kind,
        source,
        enabled: settings.enabled,
        recipient_roles: [...settings.recipientRoles],
        channels: [...settings.channels],
        delay_minutes: settings.delayMinutes,
        lead_minutes: settings.leadMinutes,
        fixed_recipients: ALERT_KIND_DEFINITIONS[kind].fixedRecipients.map(fixedView),
        revision: scopeRule?.revision ?? null,
      };
    }),
  };
}
