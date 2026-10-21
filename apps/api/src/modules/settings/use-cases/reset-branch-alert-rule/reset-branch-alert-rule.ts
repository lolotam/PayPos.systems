import type { AlertKind } from '@pospay/domain';

import { ApiError } from '../../../../shared/errors.ts';
import type { AlertRulesTransactions } from '../../ports/alert-rules.port.ts';
import { auditShape } from '../set-alert-rules/set-alert-rules.ts';

// بيمسح قاعدة فرع لنوع واحد فالفرع يرجع لقاعدة النشاط (AL-Q2)؛ مسح حاجة مش موجودة مايكتبش تدقيق.
export class ResetBranchAlertRule {
  constructor(private readonly transactions: AlertRulesTransactions) {}

  async execute(
    actor: { companyId: string; userId: string },
    target: { businessId: string; branchId: string },
    kind: AlertKind,
  ): Promise<void> {
    await this.transactions.run(actor.companyId, actor.userId, async (scope) => {
      if ((await scope.access(target)) !== null) throw new ApiError('FORBIDDEN');
      const removed = await scope.deleteBranchRule(target, kind);
      if (removed === null) return;
      await scope.audit.record({
        entity: 'alert_rule',
        entityId: target.branchId,
        action: 'alert_rule.branch_reset',
        before: auditShape(target, kind, removed),
        after: auditShape(target, kind, null),
      });
    });
  }
}
