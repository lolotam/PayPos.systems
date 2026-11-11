import { createCommissionInputsConsumer } from '../modules/commissions/index.ts';
import { readEmployeeBusiness } from '../modules/staff/index.ts';
import { businessCalendar } from '../modules/tenancy/index.ts';
import type { OutboxConsumer } from '../outbox/consumer.ts';

type CommissionInputsTestDependencies = Omit<
  Parameters<typeof createCommissionInputsConsumer>[0],
  'employeeBusiness' | 'businessCalendar'
>;

// بيربط قرّاء staff و tenancy الحقيقيين زي main.ts، لأن spec جوه موديول commissions
// ممنوع يستورد موديول تاني، والاختبارات محتاجة القرّاء دول على قاعدة البيانات نفسها.
export function createTestCommissionInputsConsumer(
  dependencies: CommissionInputsTestDependencies,
): OutboxConsumer {
  return createCommissionInputsConsumer({
    ...dependencies,
    employeeBusiness: readEmployeeBusiness,
    businessCalendar,
  });
}
