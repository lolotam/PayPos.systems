import type { ReopenServiceCategoryInput, ServiceCategoryReopenOutcome } from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { ServiceCategoryError } from '../../domain/errors.ts';
import { serviceCategoryView, type ServiceCategoryRecord } from '../../domain/service-category.ts';
import {
  assertServiceCategoryReopenable,
  planServiceCategoryReopen,
} from '../../domain/service-category-closing.ts';
import { serviceCategoryClosingPath } from '../../domain/service-category-closing-path.ts';
import type {
  ServiceCategoryActor,
  ServiceCategoryScope,
  ServiceCategoryTransactions,
} from '../../ports/service-category-transactions.port.ts';
import {
  pendingClosingOutcome,
  requestServiceCategoryClosing,
  resolvePendingClosing,
} from '../service-category-closing-request.ts';

export { ServiceCategoryError };

export interface ReopenServiceCategoryCommand extends ServiceCategoryActor {
  readonly businessId: string;
  readonly categoryId: string;
  readonly input: ReopenServiceCategoryInput;
}

/**
 * يفتح تصنيف خدمات ويرجع الخدمات التي أغلقها هو فقط، بقفل موحّد ونسخة وعدد متوقعين وتدقيق
 * دفعي. فوق حد القفل المتزامن ما فيش فتح ولا تدقيق: الطلب بيتقبل في الخلفية والتصنيف
 * ما يتغيّرش.
 */
export class ReopenServiceCategoryUseCase {
  constructor(
    private readonly transactions: ServiceCategoryTransactions,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  execute(command: ReopenServiceCategoryCommand): Promise<ServiceCategoryReopenOutcome> {
    return this.transactions.run(command, async (scope) => {
      const current = await scope.load(command.businessId, command.categoryId);
      if (current === null) throw new ServiceCategoryError('SERVICE_CATEGORY_NOT_FOUND');
      const now = this.clock.now();
      // الطلب المعلّق بيتفحص قبل النسخة والحالة والعدد: التصنيف مشغول، فأي طلب تاني عليه
      // يرد «شغّال» ومعاه هوية الطلب، مش «نسخة قديمة» اللي الشاشة بتتوقع غيرها.
      const pending = await resolvePendingClosing(
        scope,
        command.businessId,
        command.categoryId,
        {
          action: 'reopen',
          expected_revision: command.input.expected_revision,
          expected_service_count: command.input.expected_service_count,
        },
        now,
      );
      const replayed = pendingClosingOutcome(pending);
      if (replayed !== null) return replayed;
      assertServiceCategoryReopenable(current, command.input);
      const count = await scope.countAffectedServices(
        command.businessId,
        command.categoryId,
        'marked',
      );
      if (count !== command.input.expected_service_count)
        throw new ServiceCategoryError('SERVICE_CATEGORY_COUNT_CHANGED');
      return serviceCategoryClosingPath(count) === 'sync'
        ? this.reopenNow(scope, command, current, now)
        : requestServiceCategoryClosing(scope, this.ids, {
            business_id: command.businessId,
            category_id: command.categoryId,
            action: 'reopen',
            expected_revision: command.input.expected_revision,
            expected_service_count: count,
            requested_by: command.userId,
            requested_at: now,
          });
    });
  }

  /** الفتح المتزامن: نفس خطوات #996 كما هي، بتأثيره وتدقيقه في معاملة واحدة. */
  private async reopenNow(
    scope: ServiceCategoryScope,
    command: ReopenServiceCategoryCommand,
    current: ServiceCategoryRecord,
    now: Date,
  ): Promise<ServiceCategoryReopenOutcome> {
    const marked = await scope.lockMarkedServices(command.businessId, command.categoryId);
    const plan = planServiceCategoryReopen(current, command.input, marked, now);
    await scope.saveClosing(plan.category, plan.services);
    await scope.auditClosing({ ...plan, action: 'reopened' });
    return {
      kind: 'done',
      result: {
        ...serviceCategoryView(plan.category.after),
        services_reopened: plan.services.length,
      },
    };
  }
}
