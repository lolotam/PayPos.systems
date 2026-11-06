import { PackageCommitError, packageCommitRows } from '../../domain/package-import-commit.ts';
import type {
  PackageCommitClock,
  PackageCommitTransactions,
} from '../../ports/package-import-commit.port.ts';

/** إعادة محاولة آمنة لا تحمل نص SQL أو معاملاته، وتحفظ سبب الرفض عند تعذر تثبيته. */
export class PackageCommitRetryError extends Error {
  /**
   * يحفظ رمزًا مسموحًا فقط لاستكمال تثبيت الفشل في المحاولة التالية.
   *
   * @param failureCode سبب الرفض الدائم عند تعذر حفظه
   */
  constructor(readonly failureCode?: PackageCommitError['code']) {
    super('PACKAGE_IMPORT_COMMIT_RETRY');
    this.name = 'PackageCommitRetryError';
  }
}

export class CommitPackageImport {
  constructor(
    private readonly transactions: PackageCommitTransactions,
    private readonly clock: PackageCommitClock,
  ) {}

  async execute(companyId: string, previewId: string): Promise<void> {
    try {
      await this.transactions.run(companyId, previewId, async (scope) => {
        if (scope.preview === null) return;
        const rows = packageCommitRows(scope.preview);
        await scope.lockServices(rows);
        const at = this.clock.now().toISOString();
        let created = 0;
        for (const row of rows) if (await scope.insert(row, at)) created++;
        await scope.writeSlots();
        await scope.complete(created, at);
      });
    } catch (error) {
      if (!(error instanceof PackageCommitError)) throw new PackageCommitRetryError();
      try {
        await this.transactions.fail(companyId, previewId, error.code);
      } catch {
        throw new PackageCommitRetryError(error.code);
      }
    }
  }
}
