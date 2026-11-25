import {
  SERVICE_IMPORT_RECOVERY_MAX_PAGES,
  serviceImportCommitStaleBefore,
} from '../../domain/service-import-recovery.ts';
import type { Clock } from '../../ports/clock.port.ts';
import type { ServiceImportRecoveryTransactions } from '../../ports/service-import-recovery.port.ts';

/** يغلق طلبات تثبيت الخدمات العالقة بفشل مسمى بدل تركها معلقة بلا نهاية أو إعادة تنفيذ قد تكرر أثرها المالي. */
export class RecoverServiceImports {
  constructor(
    private readonly transactions: ServiceImportRecoveryTransactions,
    private readonly clock: Clock,
  ) {}

  async execute(companyId: string): Promise<void> {
    const before = serviceImportCommitStaleBefore(this.clock.now());
    for (let page = 0; page < SERVICE_IMPORT_RECOVERY_MAX_PAGES; page += 1) {
      const failed = await this.transactions.failStalePage(companyId, before);
      if (failed === 0) return;
    }
  }
}
