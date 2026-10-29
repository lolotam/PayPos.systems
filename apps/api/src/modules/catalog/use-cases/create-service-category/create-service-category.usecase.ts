import type {
  CreateBranchServiceCategoryInput,
  CreateServiceCategoryInput,
  ServiceCategory,
} from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { ServiceCategoryError } from '../../domain/errors.ts';
import {
  newBranchServiceCategory,
  newBusinessServiceCategory,
  serviceCategoryView,
  validateServiceCategoryNames,
  type ServiceCategoryNames,
  type ServiceCategoryRecord,
} from '../../domain/service-category.ts';
import type {
  ServiceCategoryActor,
  ServiceCategoryScope,
  ServiceCategoryTransactions,
} from '../../ports/service-category-transactions.port.ts';

export { ServiceCategoryError };

/** إنشاء تصنيف على مستوى النشاط: لا فرع مالك، والمشاركة مع كل الفروع. */
export interface CreateServiceCategoryCommand extends ServiceCategoryActor {
  readonly businessId: string;
  readonly input: CreateServiceCategoryInput;
}

/** إنشاء تصنيف من فرع: الفرع يسجله مالكاً، والمشاركة يختارها صاحبه. */
export interface CreateBranchServiceCategoryCommand extends ServiceCategoryActor {
  readonly businessId: string;
  readonly branchId: string;
  readonly input: CreateBranchServiceCategoryInput;
}

/** طلب الإنشاء من أي من المسارين. */
export type CreateServiceCategoryRequest =
  CreateServiceCategoryCommand | CreateBranchServiceCategoryCommand;

/** ينشئ تصنيف خدمة على مستوى النشاط أو من فرع، ويسجله بالتدقيق؛ بلا أثر مالي وبلا حدث. */
export class CreateServiceCategoryUseCase {
  constructor(
    private readonly transactions: ServiceCategoryTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  execute(command: CreateServiceCategoryRequest): Promise<ServiceCategory> {
    return this.transactions.run(command, async (scope) => {
      const names = validateServiceCategoryNames(command.input);
      const record = await this.build(scope, command, names);
      await scope.insert(record);
      await scope.audit(null, record);
      return serviceCategoryView(record);
    });
  }

  /**
   * يبني سجل التصنيف من مسار الطلب: نشاط أو فرع، ونشاط الفرع يُقرأ من القاعدة لا من العميل.
   *
   * @param scope معاملة الكتابة
   * @param command الطلب المحقّق
   * @param names الاسمان المتحققان
   * @returns سجل التصنيف قبل الحفظ
   */
  private async build(
    scope: ServiceCategoryScope,
    command: CreateServiceCategoryRequest,
    names: ServiceCategoryNames,
  ): Promise<ServiceCategoryRecord> {
    if ('branchId' in command) {
      const businessId = await scope.branchBusiness(command.branchId);
      if (businessId === null || businessId !== command.businessId)
        throw new ServiceCategoryError('SERVICE_CATEGORY_NOT_FOUND');
      return newBranchServiceCategory(
        names,
        this.ids.newId(),
        businessId,
        command.branchId,
        command.input.visibility,
        this.clock.now(),
      );
    }
    return newBusinessServiceCategory(
      names,
      this.ids.newId(),
      command.businessId,
      this.clock.now(),
    );
  }
}
