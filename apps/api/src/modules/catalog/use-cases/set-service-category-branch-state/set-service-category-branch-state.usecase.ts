import type {
  ServiceCategoryBranchStateResult,
  SetServiceCategoryBranchStateInput,
} from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { ServiceCategoryError } from '../../domain/errors.ts';
import {
  planServiceCategoryBranchState,
  serviceCategoryBranchView,
} from '../../domain/service-category-branch.ts';
import type {
  ServiceCategoryActor,
  ServiceCategoryTransactions,
} from '../../ports/service-category-transactions.port.ts';

export { ServiceCategoryError };

/** طلب تفعيل أو إخفاء تصنيف داخل فرع، مع النشاط المؤكد من المسار. */
export interface SetServiceCategoryBranchStateCommand extends ServiceCategoryActor {
  readonly businessId: string;
  readonly branchId: string;
  readonly categoryId: string;
  readonly input: SetServiceCategoryBranchStateInput;
}

/** يفعّل أو يخفي تصنيفاً في فرع واحد، بنسخة متفائلة وتدقيق في المعاملة نفسها. */
export class SetServiceCategoryBranchStateUseCase {
  constructor(
    private readonly transactions: ServiceCategoryTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  execute(command: SetServiceCategoryBranchStateCommand): Promise<ServiceCategoryBranchStateResult> {
    return this.transactions.run(command, async (scope) => {
      const businessId = await scope.branchBusiness(command.branchId);
      if (businessId === null || businessId !== command.businessId)
        throw new ServiceCategoryError('SERVICE_CATEGORY_NOT_FOUND');
      const category = await scope.loadForShare(businessId, command.categoryId);
      if (category === null) throw new ServiceCategoryError('SERVICE_CATEGORY_NOT_FOUND');
      const current = await scope.loadBranchSetting(
        businessId,
        command.branchId,
        command.categoryId,
      );
      const after = planServiceCategoryBranchState(
        current,
        {
          id: current?.id ?? this.ids.newId(),
          business_id: businessId,
          branch_id: command.branchId,
          category_id: command.categoryId,
          state: command.input.state,
          category_closed: category.closed_at !== null,
          expected_revision: command.input.expected_revision,
        },
        this.clock.now(),
      );
      if (current === null) await scope.insertBranchSetting(after);
      else await scope.saveBranchSetting(current, after);
      await scope.auditBranchSetting(current, after);
      return serviceCategoryBranchView(category, after);
    });
  }
}
