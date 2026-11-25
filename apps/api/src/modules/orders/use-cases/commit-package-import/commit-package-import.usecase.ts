import type { Clock } from '../../../../shared/ports/clock.port.ts';
import {
  decidePackageImportCommit,
  requireOwnedPackageImportPreview,
  type PackageImportCommitActor,
} from '../../domain/package-import-commit.ts';
import type { PackageImportCommitTransactions } from '../../ports/package-import-commit.port.ts';

// يقبل طلب تثبيت واحداً فقط؛ الإنشاء الذري الثقيل يخص وظيفة العامل (47-2b)، وهنا لا حساب ولا مال.
export class CommitPackageImportUseCase {
  constructor(
    private readonly transactions: PackageImportCommitTransactions,
    private readonly clock: Clock,
  ) {}

  execute(command: PackageImportCommitActor) {
    return this.transactions.runCommit(command, async (scope) => {
      const preview = await scope.load(command.previewId);
      requireOwnedPackageImportPreview(preview, command);
      const requestedAt = this.clock.now();
      // الطلب المقبول سابقاً لا يطلب مرتين: الرد نفسه بلا تحديث ولا حدث جديد.
      if (decidePackageImportCommit(preview, requestedAt) === 'REQUEST')
        await scope.request(preview.id, requestedAt.toISOString());
      return { preview_id: preview.id };
    });
  }
}

export { PackageImportCommitError } from '../../domain/package-import-commit.ts';
