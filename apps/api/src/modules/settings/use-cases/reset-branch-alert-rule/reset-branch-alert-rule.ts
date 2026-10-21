import type { ResetBranchAlertRuleQuery } from '@pospay/contracts';
import type { AlertKind } from '@pospay/domain';

import { ApiError } from '../../../../shared/errors.ts';
import type { AlertRulesTransactions } from '../../ports/alert-rules.port.ts';
import { auditShape } from '../set-alert-rules/set-alert-rules.ts';

// بيمسح قاعدة فرع لنوع واحد فالفرع يرجع لقاعدة النشاط (AL-Q2)، وبس لما الصف اللي العميل قراه هو نفسه.
export class ResetBranchAlertRule {
  constructor(private readonly transactions: AlertRulesTransactions) {}

  async execute(
    actor: { companyId: string; userId: string },
    target: { businessId: string; branchId: string },
    kind: AlertKind,
    expected: ResetBranchAlertRuleQuery,
  ): Promise<void> {
    await this.transactions.run(actor.companyId, actor.userId, async (scope) => {
      if ((await scope.access(target)) !== null) throw new ApiError('FORBIDDEN');
      // مراجعة الصف تحت القفل قبل المسح: مسح قديم مايمسحش تعديل جديد.
      const current = (await scope.lockRules(target)).get(kind);
      if (
        current === undefined ||
        current.id.toLowerCase() !== expected.expected_rule_id.toLowerCase() ||
        current.revision !== expected.expected_revision
      )
        throw new ApiError('ALERT_RULE_REVISION_CONFLICT');
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
