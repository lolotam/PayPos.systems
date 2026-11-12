import type { ReopenServiceInput, Service } from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { ServiceError } from '../../domain/errors.ts';
import { categoriesToLock } from '../../domain/service-category-assignment.ts';
import { serviceResponse } from '../../domain/service.ts';
import { planServiceReopen } from '../../domain/service-closing.ts';
import type { ServiceScope, ServiceTransactions } from '../../ports/service-transactions.port.ts';

export { ServiceError };
export interface ReopenServiceCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly serviceId: string;
  readonly input: ReopenServiceInput;
}

/** يفتح خدمة منفردة إذا كان تصنيفها مفتوحاً، ويعيد المحاولة في معاملة جديدة عند انتقالها لتصنيف آخر. */
export class ReopenServiceUseCase {
  constructor(
    private readonly transactions: ServiceTransactions,
    private readonly clock: Clock,
  ) {}

  async execute(command: ReopenServiceCommand): Promise<Service> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.transactions.run(command, (scope) => this.reopenAttempt(command, scope));
      } catch (error) {
        if (
          !(error instanceof ServiceError) ||
          error.code !== 'TRANSACTION_RETRY_REQUIRED' ||
          attempt === 3
        )
          throw error;
      }
    }
  }

  private async reopenAttempt(
    command: ReopenServiceCommand,
    scope: ServiceScope,
  ): Promise<Service> {
    const peek = await scope.peekCategoryId(command.businessId, command.serviceId);
    if (peek === null) throw new ServiceError('SERVICE_NOT_FOUND');
    const locked = await scope.lockCategories(
      command.businessId,
      categoriesToLock(peek.category_id, peek.category_id),
    );
    const current = await scope.load(command.businessId, command.serviceId);
    if (current === null) throw new ServiceError('SERVICE_NOT_FOUND');
    if (current.category_id !== peek.category_id)
      throw new ServiceError('TRANSACTION_RETRY_REQUIRED');
    const category =
      current.category_id === null ? null : (locked.get(current.category_id) ?? null);
    if (current.category_id !== null && category === null)
      throw new ServiceError('SERVICE_CATEGORY_NOT_FOUND');
    const after = planServiceReopen(
      current,
      category,
      command.input.expected_revision,
      this.clock.now(),
    );
    await scope.save(current, after);
    await scope.audit(current, after, 'reopened');
    return serviceResponse(after, category);
  }
}
