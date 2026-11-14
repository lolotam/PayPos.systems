import type { CloseServiceCategoryInput, ServiceCategoryCloseOutcome } from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { ServiceCategoryError } from '../../domain/errors.ts';
import { serviceCategoryView, type ServiceCategoryRecord } from '../../domain/service-category.ts';
import {
  assertServiceCategoryCloseable,
  planServiceCategoryClose,
} from '../../domain/service-category-closing.ts';
import { serviceCategoryClosingPath } from '../../domain/service-category-closing-path.ts';
import type {
  ServiceCategoryActor,
  ServiceCategoryScope,
  ServiceCategoryTransactions,
} from '../../ports/service-category-transactions.port.ts';
import {
  closingValidationAfterExpiry,
  pendingClosingOutcome,
  precheckPendingClosing,
  requestServiceCategoryClosing,
  resolvePendingClosing,
  rethrowClosingRefusal,
} from '../service-category-closing-request.ts';

export { ServiceCategoryError };

export interface CloseServiceCategoryCommand extends ServiceCategoryActor {
  readonly businessId: string;
  readonly categoryId: string;
  readonly input: CloseServiceCategoryInput;
}

/**
 * يغلق تصنيف خدمات وكل خدماته المفتوحة بعد تثبيت النسخة والعدد، ويسجل أثره كاملاً في التدقيق.
 * فوق حد القفل المتزامن ما فيش قفل ولا تدقيق: الطلب بيتقبل في الخلفية والتصنيف ما يتغيّرش.
 */
export class CloseServiceCategoryUseCase {
  constructor(
    private readonly transactions: ServiceCategoryTransactions,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(command: CloseServiceCategoryCommand): Promise<ServiceCategoryCloseOutcome> {
    const outcome = await this.transactions.run(command, async (scope) => {
      const now = this.clock.now();
      const intent = {
        action: 'close' as const,
        expected_revision: command.input.expected_revision,
        expected_service_count: command.input.expected_service_count,
      };
      const prechecked = await precheckPendingClosing(
        scope,
        command.businessId,
        command.categoryId,
        intent,
        now,
      );
      if (prechecked !== null) return prechecked;
      const current = await scope.load(command.businessId, command.categoryId);
      if (current === null) throw new ServiceCategoryError('SERVICE_CATEGORY_NOT_FOUND');
      // الطلب المعلّق بيتفحص قبل النسخة والحالة والعدد: التصنيف مشغول، فأي طلب تاني عليه
      // يرد «شغّال» ومعاه هوية الطلب، مش «نسخة قديمة» اللي الشاشة بتتوقع غيرها.
      const pending = await resolvePendingClosing(
        scope,
        command.businessId,
        command.categoryId,
        intent,
        now,
      );
      const replayed = pendingClosingOutcome(pending);
      if (replayed !== null) return replayed;
      const validated = await closingValidationAfterExpiry(pending, async () => {
        assertServiceCategoryCloseable(current, command.input);
        const count = await scope.countAffectedServices(
          command.businessId,
          command.categoryId,
          'open',
        );
        if (count !== command.input.expected_service_count)
          throw new ServiceCategoryError('SERVICE_CATEGORY_COUNT_CHANGED');
        return count;
      });
      if (typeof validated !== 'number') return validated;
      const count = validated;
      return serviceCategoryClosingPath(count) === 'sync'
        ? this.closeNow(scope, command, current, now)
        : requestServiceCategoryClosing(scope, this.ids, {
            business_id: command.businessId,
            category_id: command.categoryId,
            action: 'close',
            expected_revision: command.input.expected_revision,
            expected_service_count: count,
            requested_by: command.userId,
            requested_at: now,
          });
    });
    return rethrowClosingRefusal(outcome);
  }

  /** القفل المتزامن: نفس خطوات #996 كما هي، بتأثيره وتدقيقه في معاملة واحدة. */
  private async closeNow(
    scope: ServiceCategoryScope,
    command: CloseServiceCategoryCommand,
    current: ServiceCategoryRecord,
    now: Date,
  ): Promise<ServiceCategoryCloseOutcome> {
    const services = await scope.lockOpenServices(command.businessId, command.categoryId);
    const plan = planServiceCategoryClose(current, command.input, services, now);
    await scope.saveClosing(plan.category, plan.services);
    await scope.auditClosing({ ...plan, action: 'closed' });
    return {
      kind: 'done',
      result: {
        ...serviceCategoryView(plan.category.after),
        services_closed: plan.services.length,
      },
    };
  }
}
