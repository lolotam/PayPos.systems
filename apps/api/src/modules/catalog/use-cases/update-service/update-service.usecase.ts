import type { Service, UpdateServiceInput } from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { ServiceError } from '../../domain/errors.ts';
import {
  assertCategoryAssignable,
  categoriesToLock,
  categoryChanged,
  nextCategoryId,
} from '../../domain/service-category-assignment.ts';
import { planServiceUpdate, serviceResponse, serviceUpdateTerms } from '../../domain/service.ts';
import type { ServiceTransactions } from '../../ports/service-transactions.port.ts';

export { ServiceError } from '../../domain/errors.ts';
export interface UpdateServiceCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly serviceId: string;
  readonly input: UpdateServiceInput;
}

/** يعدّل سعر الخدمة وقاعدة عمولتها ومدتها وتصنيفها مقابل النسخة المتوقعة، ويسجّل قبل/بعد في التدقيق. */
export class UpdateServiceUseCase {
  constructor(
    private readonly transactions: ServiceTransactions,
    private readonly clock: Clock,
  ) {}

  async execute(command: UpdateServiceCommand): Promise<Service> {
    return this.transactions.run(command, async (scope) => {
      const peek = await scope.peekCategoryId(command.businessId, command.serviceId);
      if (peek === null) throw new ServiceError('SERVICE_NOT_FOUND');
      const next = nextCategoryId(command.input.category_id, peek.category_id);
      // أقفال التصنيفات تسبق قفل صف الخدمة، بنفس ترتيب أي كتابة على التصنيف، عشان التعديل والإغلاق ما يعملوش deadlock.
      const locked = await scope.lockCategories(
        command.businessId,
        categoriesToLock(peek.category_id, next),
      );
      const current = await scope.load(command.businessId, command.serviceId);
      if (current === null) throw new ServiceError('SERVICE_NOT_FOUND');
      // التصنيف اتغير بين القراءة والقفل، فالتعديل ده اتعمل على نسخة أقدم من اللي العميل شافها.
      if (current.category_id !== peek.category_id)
        throw new ServiceError('SERVICE_REVISION_CONFLICT');
      const terms = serviceUpdateTerms(command.input, current);
      // الإبقاء على نفس التصنيف مش تعيين جديد، فمش محتاج فحص الفتح؛ إغلاق التصنيف وأثره على خدماته شغل 32b-cat-2.
      if (categoryChanged(current.category_id, terms.category_id) && terms.category_id !== null)
        assertCategoryAssignable(locked.get(terms.category_id) ?? null, command.businessId);
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
      const category =
        plan.after.category_id === null ? null : (locked.get(plan.after.category_id) ?? null);
      return serviceResponse(plan.after, category);
    });
  }
}
