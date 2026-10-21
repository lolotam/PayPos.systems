import type { SetAlertRulesInput } from '@pospay/contracts';
import {
  alertKindAllowsBranchOverride,
  alertRuleViolation,
  sameAlertRuleSettings,
  type AlertKind,
  type AlertRuleSettings,
} from '@pospay/domain';

import { ApiError } from '../../../../shared/errors.ts';
import type {
  AlertRulesTransactions,
  AlertRuleTarget,
  StoredAlertRule,
} from '../../ports/alert-rules.port.ts';

/** نوع اتغيّر في الطلب: قبل (null = الافتراضي أو قاعدة النشاط) وبعد. */
export interface AlertRuleChange {
  readonly kind: AlertKind;
  readonly before: StoredAlertRule | null;
  readonly after: StoredAlertRule;
}

// بيكتب قواعد أنواع التنبيه للنشاط أو لفرع منه بعد فحص الصلاحية تحت القفل، وكل نوع اتغيّر ليه سطر تدقيق قبل/بعد.
export class SetAlertRules {
  constructor(private readonly transactions: AlertRulesTransactions) {}

  async execute(
    actor: { companyId: string; userId: string },
    target: AlertRuleTarget,
    input: SetAlertRulesInput,
  ): Promise<readonly AlertRuleChange[]> {
    const requested = input.rules.map((rule) => ({ kind: rule.kind, settings: settingsOf(rule) }));
    return this.transactions.run(actor.companyId, actor.userId, async (scope) => {
      // الصلاحية قبل التحقق من القيم، عشان منع على الفرع يرجع 403 واحدة مهما كان الطلب.
      if ((await scope.access(target)) !== null) throw new ApiError('FORBIDDEN');
      for (const { kind, settings } of requested)
        if (
          alertRuleViolation(kind, settings) !== null ||
          (target.branchId !== null && !alertKindAllowsBranchOverride(kind))
        )
          throw new ApiError('ALERT_RULE_INVALID');
      const stored = await scope.lockRules(target);
      const changes: AlertRuleChange[] = [];
      for (const { kind, settings } of requested) {
        const before = stored.get(kind) ?? null;
        if (before !== null && sameAlertRuleSettings(before, settings)) continue;
        const after = await scope.saveRule(target, kind, settings, actor.userId);
        await scope.audit.record({
          entity: 'alert_rule',
          entityId: target.branchId ?? target.businessId,
          action: 'alert_rule.saved',
          before: auditShape(target, kind, before),
          after: auditShape(target, kind, after),
        });
        changes.push({ kind, before, after });
      }
      return changes;
    });
  }
}

function settingsOf(rule: SetAlertRulesInput['rules'][number]): AlertRuleSettings {
  return {
    enabled: rule.enabled,
    recipientRoles: rule.recipient_roles,
    channels: rule.channels,
    delayMinutes: rule.delay_minutes,
    leadMinutes: rule.lead_minutes,
  };
}

/**
 * شكل القاعدة في سطر التدقيق.
 *
 * @param target النشاط والفرع
 * @param kind   النوع
 * @param rule   القاعدة أو null لو مكانتش مخزنة
 * @returns القيم بأسماء الأعمدة
 */
export function auditShape(target: AlertRuleTarget, kind: AlertKind, rule: StoredAlertRule | null) {
  return {
    business_id: target.businessId,
    branch_id: target.branchId,
    kind,
    rule:
      rule === null
        ? null
        : {
            enabled: rule.enabled,
            recipient_roles: rule.recipientRoles,
            channels: rule.channels,
            delay_minutes: rule.delayMinutes,
            lead_minutes: rule.leadMinutes,
            revision: rule.revision,
          },
  };
}
