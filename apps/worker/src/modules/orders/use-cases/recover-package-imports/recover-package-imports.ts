import {
  PACKAGE_IMPORT_RECOVERY_MAX_PAGES,
  packageImportCommitStaleBefore,
} from '../../domain/package-import-recovery.ts';
import type { PackageImportRecoveryTransactions } from '../../ports/package-import-recovery.port.ts';
import type { PackageCommitClock } from '../../ports/package-import-commit.port.ts';

/** يغلق طلبات تثبيت الباقات العالقة بفشل مسمى بدل تركها معلقة بلا نهاية أو إعادة تنفيذ قد تكرر أثرها المالي. */
export class RecoverPackageImports {
  constructor(
    private readonly transactions: PackageImportRecoveryTransactions,
    private readonly clock: PackageCommitClock,
  ) {}

  async execute(companyId: string): Promise<void> {
    const before = packageImportCommitStaleBefore(this.clock.now());
    for (let page = 0; page < PACKAGE_IMPORT_RECOVERY_MAX_PAGES; page += 1) {
      const failed = await this.transactions.failStalePage(companyId, before);
      if (failed === 0) return;
    }
  }
}
