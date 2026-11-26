import type { PackageTypeDetail, PackageTypeSellingInput } from '@pospay/contracts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { PackageTypeError } from '../../domain/errors.ts';
import {
  planPackageTypeSelling,
  resolvePackageTypeSelling,
} from '../../domain/package-type-selling.ts';
import { packageTypeView } from '../../domain/package-type.ts';
import type {
  PackageTypeActor,
  PackageTypeTransactions,
} from '../../ports/package-type-transactions.port.ts';

/** يعيد نوع الباقة للبيع للمبيعات الجديدة مع تدقيق الانتقال، ولا يغيّر الباقات المباعة. */
export class ResumeSellingPackageTypeUseCase {
  constructor(
    private readonly transactions: PackageTypeTransactions,
    private readonly clock: Clock,
  ) {}

  execute(
    command: PackageTypeActor & {
      businessId: string;
      packageTypeId: string;
      input: PackageTypeSellingInput;
    },
  ): Promise<PackageTypeDetail> {
    return this.transactions.run(command, async (scope) => {
      const current = await scope.load(command.businessId, command.packageTypeId);
      if (current === null) throw new PackageTypeError('PACKAGE_TYPE_NOT_FOUND');
      const now = this.clock.now();
      const decision = planPackageTypeSelling(
        current,
        command.input.expected_revision,
        'ACTIVE',
        now,
      );
      const selling = resolvePackageTypeSelling(decision);
      const after = { ...current, ...selling, updated_at: now.toISOString() };
      const services = await scope.services(
        command.businessId,
        current.components.map((component) => component.service_id),
      );
      // الخدمة المقفولة ترفض الاستئناف قبل أي كتابة (SI-Q28)، فلا نترك سجلاً ولا تدقيقاً.
      const view = packageTypeView(after, services);
      await scope.saveSelling(current, selling, now);
      await scope.auditSelling(current, selling);
      return view;
    });
  }
}
