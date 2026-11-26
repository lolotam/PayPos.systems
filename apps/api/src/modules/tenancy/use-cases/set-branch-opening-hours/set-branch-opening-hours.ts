import type { SetBranchOpeningHoursInput } from '@pospay/contracts';

import { planBranchOpeningHoursChange } from '../../domain/branch-opening-hours.ts';
import type {
  BranchOpeningHoursScope,
  StoredResult,
  TenancyTransactions,
} from '../../ports/tenancy-transactions.port.ts';

export interface SetBranchOpeningHoursCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly input: SetBranchOpeningHoursInput;
}

// يستبدل مواعيد عمل الفرع تحت قفل صفّه: عمود واحد فقط بيتغير، والتغيير الحقيقي وحده يُكتب ويُدوَّن.
export class SetBranchOpeningHours {
  readonly #transactions: TenancyTransactions;

  constructor(transactions: TenancyTransactions) {
    this.#transactions = transactions;
  }

  /**
   * يقفل صف الفرع تحت النشاط المحدد ويقرأ مواعيده، يقرر بالدالة الصافية، ثم يكتب عمود المواعيد وحده ويدوّن
   * قيمة ما قبل وما بعد — كل ذلك في transaction واحدة؛ تسجيل التدقيق الفاشل يرجع الكتابة معه.
   * المواعيد المتساوية المعنى لا تكتب ولا تُدوَّن، والفرع الغائب أو التابع لنشاط آخر يجيبه `null` (نفس 404).
   *
   * @param command الشركة المتحقق منها والفاعل والنشاط والفرع والمواعيد المتحقق منها من العقد
   * @returns 200 بالفرع بعد التعديل، أو `null` حين الفرع غير مرئي (المسار يبني 404 منها)
   */
  async execute(command: SetBranchOpeningHoursCommand): Promise<StoredResult | null> {
    const { companyId, userId, businessId, branchId, input } = command;
    return this.#transactions.runBranchOpeningHoursChange({ companyId, userId }, async (scope) =>
      changeHours(scope, businessId, branchId, input.opening_hours),
    );
  }
}

async function changeHours(
  scope: BranchOpeningHoursScope,
  businessId: string,
  branchId: string,
  requested: SetBranchOpeningHoursInput['opening_hours'],
): Promise<StoredResult | null> {
  const stored = await scope.lockBranchOpeningHours(businessId, branchId);
  if (stored === null) return null;
  if (planBranchOpeningHoursChange(stored.openingHours, requested)) {
    await scope.saveBranchOpeningHours(branchId, requested);
    await scope.audit.record({
      entity: 'branch',
      entityId: branchId,
      action: 'opening_hours.changed',
      before: { opening_hours: stored.openingHours },
      after: { opening_hours: requested },
    });
  }
  return { status: 200, body: await scope.readBranch(branchId) };
}
