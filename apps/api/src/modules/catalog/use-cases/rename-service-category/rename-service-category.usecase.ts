import type { RenameServiceCategoryInput, ServiceCategory } from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { ServiceCategoryError } from '../../domain/errors.ts';
import {
  planServiceCategoryRename,
  serviceCategoryView,
  type ServiceCategoryRenameRequest,
} from '../../domain/service-category.ts';
import type {
  ServiceCategoryActor,
  ServiceCategoryScope,
  ServiceCategoryTransactions,
} from '../../ports/service-category-transactions.port.ts';

export { ServiceCategoryError };

/** تعديل تصنيف على مستوى النشاط: أي تصنيف في النشاط، والمشاركة في اتجاه واحد. */
export interface RenameServiceCategoryCommand extends ServiceCategoryActor {
  readonly businessId: string;
  readonly categoryId: string;
  readonly input: RenameServiceCategoryInput;
}

/** تعديل تصنيف من فرع: تصنيفات هذا الفرع الخاصة به وحدها. */
export interface RenameBranchServiceCategoryCommand extends ServiceCategoryActor {
  readonly businessId: string;
  readonly branchId: string;
  readonly categoryId: string;
  readonly input: RenameServiceCategoryInput;
}

/** طلب التعديل من أي من المسارين. */
export type RenameServiceCategoryRequest =
  RenameServiceCategoryCommand | RenameBranchServiceCategoryCommand;

/** يعدّل تصنيف خدمة: الأسماء والمشاركة، بقفل الصف أولاً، وكل تغيير يرفع النسخة ويسجل في التدقيق. */
export class RenameServiceCategoryUseCase {
  constructor(
    private readonly transactions: ServiceCategoryTransactions,
    private readonly clock: Clock,
  ) {}

  execute(command: RenameServiceCategoryRequest): Promise<ServiceCategory> {
    return this.transactions.run(command, async (scope) => {
      const businessId = await this.businessOf(scope, command);
      const current = await scope.load(businessId, command.categoryId);
      if (current === null) throw new ServiceCategoryError('SERVICE_CATEGORY_NOT_FOUND');
      const plan = planServiceCategoryRename(current, this.request(command), this.clock.now());
      if (plan.changed) {
        await scope.save(current, plan.after);
        await scope.audit(current, plan.after);
      }
      return serviceCategoryView(plan.after);
    });
  }

  /**
   * يبني طلب التعديل: النطاق يحدده المسار، والمشاركة تُرسل فقط لو طلبها العميل.
   *
   * @param command الطلب المحقّق
   * @returns طلب التعديل كما يفهمه النطاق
   */
  private request(command: RenameServiceCategoryRequest): ServiceCategoryRenameRequest {
    const base = {
      names: { name_en: command.input.name_en, name_ar: command.input.name_ar },
      expected_revision: command.input.expected_revision,
      scope: 'branchId' in command ? ('BRANCH' as const) : ('BUSINESS' as const),
      branch_id: 'branchId' in command ? command.branchId : null,
    };
    const visibility = command.input.visibility;
    return visibility === undefined ? base : { ...base, visibility };
  }

  /**
   * يحدد النشاط الذي يقع فيه التصنيف: نشاط الفرع يُقرأ من القاعدة، فلا يوسّع به العميل وصوله.
   *
   * @param scope معاملة الكتابة
   * @param command الطلب المحقّق
   * @returns النشاط المالك للتصنيف
   */
  private async businessOf(
    scope: ServiceCategoryScope,
    command: RenameServiceCategoryRequest,
  ): Promise<string> {
    if (!('branchId' in command)) return command.businessId;
    const businessId = await scope.branchBusiness(command.branchId);
    if (businessId === null || businessId !== command.businessId)
      throw new ServiceCategoryError('SERVICE_CATEGORY_NOT_FOUND');
    return businessId;
  }
}
