import type { Customer, FindOrCreateCustomerInput } from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { customerForReception } from '../../domain/customer.ts';
import { normalizePhone } from '../../domain/phone.ts';
import type { CustomerTransactions } from '../../ports/customer-transactions.port.ts';

export { InvalidCustomerPhoneError } from '../../domain/errors.ts';

export interface FindOrCreateCustomerCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly input: FindOrCreateCustomerInput;
}

// يربط الاستقبال بهوية الشركة دون تعديل بيانات عميل موجود، ويسجل الإنشاء فقط.
export class FindOrCreateCustomerUseCase {
  constructor(
    private readonly transactions: CustomerTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(command: FindOrCreateCustomerCommand): Promise<Customer> {
    const phone = normalizePhone(command.input.phone);
    return this.transactions.run(command, async (scope) => {
      const result = await scope.findOrCreate({
        ...command.input,
        phone,
        id: this.ids.newId(),
        at: this.clock.now(),
      });
      const body = customerForReception(result.customer);
      // الهاتف الكامل ممنوع في سجل العميل أيضاً؛ الـ snapshot له نفس قائمة حقول الاستجابة الآمنة.
      if (result.created) {
        await scope.audit.record({
          entity: 'customer',
          entityId: body.id,
          action: 'created',
          after: body,
        });
      }
      return body;
    });
  }
}
