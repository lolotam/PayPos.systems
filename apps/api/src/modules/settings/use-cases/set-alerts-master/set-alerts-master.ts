import type { AlertRules } from '@pospay/contracts';

import { ApiError } from '../../../../shared/errors.ts';
import type { AlertRulesTransactions } from '../../ports/alert-rules.port.ts';
import type { SettingsCache } from '../../ports/settings.port.ts';
import { alertRulesView } from '../alert-rules-view/alert-rules-view.ts';

// بيقفل أو يفتح كل تنبيهات الفريق للنشاط مرة واحدة (AL-Q4)؛ نفس القيمة تاني مابتكتبش تدقيق.
export class SetAlertsMaster {
  constructor(
    private readonly transactions: AlertRulesTransactions,
    private readonly cache?: Pick<SettingsCache, 'invalidate'>,
  ) {}

  async execute(
    actor: { companyId: string; userId: string },
    businessId: string,
    alertsEnabled: boolean,
  ): Promise<AlertRules> {
    const target = { businessId, branchId: null };
    let changed = false;
    const view = await this.transactions.run(actor.companyId, actor.userId, async (scope) => {
      if ((await scope.access(target)) !== null) throw new ApiError('FORBIDDEN');
      const before = await scope.lockMaster(businessId);
      changed = (before ?? true) !== alertsEnabled;
      if (changed) {
        await scope.saveMaster(businessId, alertsEnabled);
        await scope.audit.record({
          entity: 'alert_rules_master',
          entityId: businessId,
          action: alertsEnabled ? 'alert_rules_master.enabled' : 'alert_rules_master.disabled',
          before: { business_id: businessId, alerts_enabled: before },
          after: { business_id: businessId, alerts_enabled: alertsEnabled },
        });
      }
      return alertRulesView(target, await scope.snapshot(target));
    });
    // الإبطال بعد الـ commit بس لما المفتاح اتغيّر فعلاً: القراءة المخزنة لازم تشوف القيمة الجديدة.
    if (changed) await this.cache?.invalidate(actor.companyId, businessId);
    return view;
  }
}
