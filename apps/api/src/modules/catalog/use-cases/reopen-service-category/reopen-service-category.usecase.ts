import type { ReopenServiceCategoryInput, ReopenServiceCategoryResult } from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { ServiceCategoryError } from '../../domain/errors.ts';
import { serviceCategoryView } from '../../domain/service-category.ts';
import {
  assertServiceCategoryReopenable,
  planServiceCategoryReopen,
} from '../../domain/service-category-closing.ts';
import type {
  ServiceCategoryActor,
  ServiceCategoryTransactions,
} from '../../ports/service-category-transactions.port.ts';

export { ServiceCategoryError };

export interface ReopenServiceCategoryCommand extends ServiceCategoryActor {
  readonly businessId: string;
  readonly categoryId: string;
  readonly input: ReopenServiceCategoryInput;
}

/** يفتح تصنيف خدمات ويرجع الخدمات التي أغلقها هو فقط، بقفل موحّد ونسخة وعدد متوقعين وتدقيق دفعي. */
export class ReopenServiceCategoryUseCase {
  constructor(
    private readonly transactions: ServiceCategoryTransactions,
    private readonly clock: Clock,
  ) {}

  execute(command: ReopenServiceCategoryCommand): Promise<ReopenServiceCategoryResult> {
    return this.transactions.run(command, async (scope) => {
      const current = await scope.load(command.businessId, command.categoryId);
      if (current === null) throw new ServiceCategoryError('SERVICE_CATEGORY_NOT_FOUND');
      assertServiceCategoryReopenable(current, command.input);
      const marked = await scope.lockMarkedServices(command.businessId, command.categoryId);
      const plan = planServiceCategoryReopen(current, command.input, marked, this.clock.now());
      await scope.saveClosing(plan.category, plan.services);
      await scope.auditClosing({ ...plan, action: 'reopened' });
      return {
        ...serviceCategoryView(plan.category.after),
        services_reopened: plan.services.length,
      };
    });
  }
}
