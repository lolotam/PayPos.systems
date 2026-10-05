import type { Service, UpdateServiceInput } from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { ServiceError } from '../../domain/errors.ts';
import { planServiceUpdate, serviceSnapshot, serviceTerms } from '../../domain/service.ts';
import type { ServiceTransactions } from '../../ports/service-transactions.port.ts';

export { ServiceError } from '../../domain/errors.ts';
export interface UpdateServiceCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly serviceId: string;
  readonly input: UpdateServiceInput;
}

// يعدل خدمة النشاط بعد قفل الصف وفحص النسخة، ويسجل تغيير السعر أو القاعدة في سجل التدقيق.
export class UpdateServiceUseCase {
  constructor(
    private readonly transactions: ServiceTransactions,
    private readonly clock: Clock,
  ) {}

  async execute(command: UpdateServiceCommand): Promise<Service> {
    const saved = await this.transactions.run(command, async (scope) => {
      const current = await scope.load(command.businessId, command.serviceId);
      if (current === null) throw new ServiceError('SERVICE_NOT_FOUND');
      const terms = serviceTerms(command.input);
      const plan = planServiceUpdate(
        current,
        terms,
        command.input.expected_revision,
        this.clock.now(),
      );
      // لا نكتب ولا نكرر التدقيق لو مفيش تغيير فعلي؛ الطلب نفسه صحيح وبيرجع نفس السجل.
      if (plan.changed) {
        await scope.save(current, plan.after);
        await scope.audit(current, plan.after);
      }
      return plan.after;
    });
    return serviceSnapshot(saved);
  }
}
