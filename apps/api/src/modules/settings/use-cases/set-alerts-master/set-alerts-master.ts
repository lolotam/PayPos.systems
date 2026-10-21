import { ApiError } from '../../../../shared/errors.ts';
import type { AlertRulesTransactions } from '../../ports/alert-rules.port.ts';

// بيقفل أو يفتح كل تنبيهات الفريق للنشاط مرة واحدة (AL-Q4)؛ نفس القيمة تاني مابتكتبش تدقيق.
export class SetAlertsMaster {
  constructor(private readonly transactions: AlertRulesTransactions) {}

  async execute(
    actor: { companyId: string; userId: string },
    businessId: string,
    alertsEnabled: boolean,
  ): Promise<void> {
    await this.transactions.run(actor.companyId, actor.userId, async (scope) => {
      if ((await scope.access({ businessId, branchId: null })) !== null)
        throw new ApiError('FORBIDDEN');
      const before = await scope.lockMaster(businessId);
      if ((before ?? true) === alertsEnabled) return;
      await scope.saveMaster(businessId, alertsEnabled, actor.userId);
      await scope.audit.record({
        entity: 'alert_rules_master',
        entityId: businessId,
        action: alertsEnabled ? 'alert_rules_master.enabled' : 'alert_rules_master.disabled',
        before: { business_id: businessId, alerts_enabled: before },
        after: { business_id: businessId, alerts_enabled: alertsEnabled },
      });
    });
  }
}
