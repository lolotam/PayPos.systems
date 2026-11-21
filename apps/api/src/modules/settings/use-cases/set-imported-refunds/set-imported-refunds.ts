import type { ImportedRefundsResponse, SetImportedRefundsInput } from '@pospay/contracts';

import { ApiError } from '../../../../shared/errors.ts';
import type { SettingsScope, SettingsTransactions } from '../../ports/settings.port.ts';

const auditValues = (row: { importedRefundsEnabled: boolean | null } | null) => ({
  imported_refunds_enabled: row?.importedRefundsEnabled ?? null,
});

async function writeSwitch(
  scope: SettingsScope,
  businessId: string,
  userId: string,
  enabled: boolean,
): Promise<boolean> {
  if ((await scope.importedRefundsAccess.check(businessId)) !== null)
    throw new ApiError('FORBIDDEN');
  const before = await scope.findForUpdate(businessId);
  if ((await scope.importedRefundsAccess.recheck(businessId)) !== null)
    throw new ApiError('FORBIDDEN');
  // القيمة الفعلية هي اللي بتتقارن: صف غايب أو NULL أو false كلهم off، فالكتابة المتكررة بنفس القيمة بدون عمل وبدون تدقيق.
  if ((before?.importedRefundsEnabled ?? false) === enabled) return enabled;
  const after = await scope.saveImportedRefunds(businessId, enabled, userId);
  await scope.audit.record({
    entity: 'business_settings',
    entityId: businessId,
    action: 'settings.imported_refunds_switched',
    before: auditValues(before),
    after: { imported_refunds_enabled: after.importedRefundsEnabled },
  });
  return enabled;
}

// المالك أو حامل صلاحية مفتاح المرتجعات المستوردة بيكتب القيمة، والتدقيق ورفض السحب المتزامن في نفس المعاملة.
export class SetImportedRefunds {
  constructor(private readonly transactions: SettingsTransactions) {}

  async execute(
    actor: { companyId: string; userId: string },
    businessId: string,
    input: SetImportedRefundsInput,
  ): Promise<ImportedRefundsResponse> {
    const imported_refunds_enabled = await this.transactions.run(
      actor.companyId,
      actor.userId,
      (scope) => writeSwitch(scope, businessId, actor.userId, input.imported_refunds_enabled),
    );
    return { imported_refunds_enabled };
  }
}
