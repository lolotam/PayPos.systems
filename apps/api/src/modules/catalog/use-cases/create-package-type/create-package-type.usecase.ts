import type { CreatePackageTypeInput, PackageTypeDetail } from '@pospay/contracts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { newPackageType, packageTypeTerms, packageTypeView } from '../../domain/package-type.ts';
import type {
  PackageTypeActor,
  PackageTypeTransactions,
} from '../../ports/package-type-transactions.port.ts';

export { PackageTypeError } from '../../domain/errors.ts';
/** ينشئ تعريف الباقة وتدقيقه دون حدث مالي؛ التقييم يحصل عند البيع. */
export class CreatePackageTypeUseCase {
  constructor(
    private readonly transactions: PackageTypeTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  execute(
    command: PackageTypeActor & { businessId: string; input: CreatePackageTypeInput },
  ): Promise<PackageTypeDetail> {
    return this.transactions.run(command, async (scope) => {
      const terms = packageTypeTerms(command.input);
      const record = newPackageType(terms, this.ids.newId(), command.businessId, this.clock.now());
      const services = await scope.services(
        command.businessId,
        terms.components.map((c) => c.service_id),
      );
      const view = packageTypeView(record, services);
      await scope.insert(record);
      await scope.audit(null, record);
      return view;
    });
  }
}
