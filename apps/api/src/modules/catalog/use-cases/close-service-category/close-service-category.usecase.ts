import type { CloseServiceCategoryInput, CloseServiceCategoryResult } from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { ServiceCategoryError } from '../../domain/errors.ts';
import { serviceCategoryView } from '../../domain/service-category.ts';
import {
  assertServiceCategoryCloseable,
  planServiceCategoryClose,
} from '../../domain/service-category-closing.ts';
import type {
  ServiceCategoryActor,
  ServiceCategoryTransactions,
} from '../../ports/service-category-transactions.port.ts';

export { ServiceCategoryError };

export interface CloseServiceCategoryCommand extends ServiceCategoryActor {
  readonly businessId: string;
  readonly categoryId: string;
  readonly input: CloseServiceCategoryInput;
}

/** يغلق تصنيف خدمات وكل خدماته المفتوحة بعد تثبيت النسخة والعدد، ويسجل أثره كاملاً في التدقيق. */
export class CloseServiceCategoryUseCase {
  constructor(
    private readonly transactions: ServiceCategoryTransactions,
    private readonly clock: Clock,
  ) {}

  execute(command: CloseServiceCategoryCommand): Promise<CloseServiceCategoryResult> {
    return this.transactions.run(command, async (scope) => {
      const current = await scope.load(command.businessId, command.categoryId);
      if (current === null) throw new ServiceCategoryError('SERVICE_CATEGORY_NOT_FOUND');
      assertServiceCategoryCloseable(current, command.input);
      const services = await scope.lockOpenServices(command.businessId, command.categoryId);
      const plan = planServiceCategoryClose(current, command.input, services, this.clock.now());
      await scope.saveClosing(plan.category, plan.services);
      await scope.auditClosing({ ...plan, action: 'closed' });
      return { ...serviceCategoryView(plan.category.after), services_closed: plan.services.length };
    });
  }
}
