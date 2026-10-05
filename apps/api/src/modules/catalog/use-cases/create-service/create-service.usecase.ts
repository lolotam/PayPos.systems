import type { CreateServiceInput, Service } from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { newService, serviceSnapshot, serviceTerms } from '../../domain/service.ts';
import type { ServiceTransactions } from '../../ports/service-transactions.port.ts';

export { ServiceError } from '../../domain/errors.ts';
export interface CreateServiceCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly input: CreateServiceInput;
}

// مفيش حدث لأن مفيش مستهلك لتغييرات الخدمة في هذه المرحلة.
export class CreateServiceUseCase {
  constructor(
    private readonly transactions: ServiceTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(command: CreateServiceCommand): Promise<Service> {
    const saved = await this.transactions.run(command, async (scope) => {
      const terms = serviceTerms(command.input);
      const record = newService(terms, this.ids.newId(), command.businessId, this.clock.now());
      await scope.insert(record);
      await scope.audit(null, record);
      return record;
    });
    return serviceSnapshot(saved);
  }
}
