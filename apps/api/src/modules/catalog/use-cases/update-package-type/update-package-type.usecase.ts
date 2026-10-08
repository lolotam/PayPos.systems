import type { PackageTypeDetail, UpdatePackageTypeInput } from '@pospay/contracts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { PackageTypeError } from '../../domain/errors.ts';
import {
  packageTypeTerms,
  packageTypeView,
  planPackageTypeUpdate,
} from '../../domain/package-type.ts';
import type {
  PackageTypeActor,
  PackageTypeTransactions,
} from '../../ports/package-type-transactions.port.ts';

/** يستبدل النوع فقط؛ المبيعات السابقة تحتفظ بلقطاتها، والطلب بلا تغيير لا يكرر التدقيق. */
export class UpdatePackageTypeUseCase {
  constructor(
    private readonly transactions: PackageTypeTransactions,
    private readonly clock: Clock,
  ) {}

  execute(
    command: PackageTypeActor & {
      businessId: string;
      packageTypeId: string;
      input: UpdatePackageTypeInput;
    },
  ): Promise<PackageTypeDetail> {
    return this.transactions.run(command, async (scope) => {
      const current = await scope.load(command.businessId, command.packageTypeId);
      if (current === null) throw new PackageTypeError('PACKAGE_TYPE_NOT_FOUND');
      const terms = packageTypeTerms(command.input);
      const plan = planPackageTypeUpdate(
        current,
        terms,
        command.input.expected_revision,
        this.clock.now(),
      );
      const services = await scope.services(
        command.businessId,
        terms.components.map((c) => c.service_id),
      );
      const view = packageTypeView(plan.after, services);
      if (plan.changed) {
        await scope.save(current, plan.after);
        await scope.audit(current, plan.after);
      }
      return view;
    });
  }
}
