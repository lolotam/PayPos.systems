import type { Country, SetBusinessCountryResult } from '@pospay/contracts';

import { planBusinessCountryChange } from '../../domain/business-country.ts';
import type {
  BusinessCountryScope,
  StoredResult,
  TenancyTransactions,
} from '../../ports/tenancy-transactions.port.ts';

export interface SetBusinessCountryCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly country: Country;
}

// يحدّد دولة النشاط في إعداداته تحت قفل صفّه: قيمة واحدة فقط تتغير، والتغيير الحقيقي وحده يُكتب ويُدوَّن.
export class SetBusinessCountry {
  readonly #transactions: TenancyTransactions;

  constructor(transactions: TenancyTransactions) {
    this.#transactions = transactions;
  }

  /**
   * يقفل صف النشاط ويقرأ إعداداته، يقرر بالدالة الصافية، ثم يكتب مفتاح country وحده ويدوّن قيمة
   * ما قبل وما بعد — كل ذلك في transaction واحدة؛ تسجيل التدقيق الفاشل يرجع الكتابة معه.
   * القيمة المتساوية لا تكتب ولا تُدوَّن، والنشاط الغائب أو لشركة أخرى يجيبه `null` (نفس 404).
   *
   * @param command الشركة المتحقق منها والفاعل والنشاط ورمز الدولة المتحقق من العقد
   * @returns 200 بالرمز المخزّن، أو `null` حين النشاط غير مرئي (المسار يبني 404 منها)
   */
  async execute(command: SetBusinessCountryCommand): Promise<StoredResult | null> {
    const { companyId, userId, businessId, country } = command;
    return this.#transactions.runBusinessCountryChange({ companyId, userId }, async (scope) =>
      changeCountry(scope, businessId, country),
    );
  }
}

async function changeCountry(
  scope: BusinessCountryScope,
  businessId: string,
  country: Country,
): Promise<StoredResult | null> {
  const settings = await scope.lockBusinessCountry(businessId);
  if (settings === null) return null;
  const decision = planBusinessCountryChange(settings, country);
  if (decision.changed) {
    await scope.saveBusinessCountry(businessId, country);
    await scope.audit.record({
      entity: 'business',
      entityId: businessId,
      action: 'country.changed',
      before: { country: decision.before },
      after: { country },
    });
  }
  const body: SetBusinessCountryResult = { business_id: businessId, country };
  return { status: 200, body };
}
