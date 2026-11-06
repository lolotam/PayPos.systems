import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import {
  pendingPackagePreview,
  requirePackageImportFile,
  type PackageImportActor,
} from '../../domain/package-import-request.ts';
import type { PackageImportRequestTransactions } from '../../ports/package-import-request.port.ts';

// لا يوجد منفذ تخزين أو قارئ مصنف هنا؛ القبول يكتب الطلب وحدثه فقط.
export class RequestPackageImportPreviewUseCase {
  constructor(
    private readonly transactions: PackageImportRequestTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  execute(command: PackageImportActor & { fileId: string }) {
    return this.transactions.run(command, async (scope) => {
      await scope.authorize();
      requirePackageImportFile(await scope.fileFacts(command.fileId), command);
      const pending = pendingPackagePreview(this.ids.newId(), command.fileId, this.clock.now());
      await scope.createPending(pending);
      await scope.publishRequested(pending.id);
      return { preview_id: pending.id };
    });
  }
}

export { PackageImportRequestError } from '../../domain/package-import-request.ts';
