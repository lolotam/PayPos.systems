import {
  PACKAGE_SALE_RECOVERY_MAX_PAGES,
  packageSaleStaleBefore,
} from '../../domain/package-sale-recovery.ts';
import type { PackageSaleRecoveryTransactions } from '../../ports/package-sale-recovery.port.ts';
import type { PackageSaleClock } from '../../ports/package-sale.port.ts';

/** يغلق طلبات البيع العالقة بأمان بدلاً من إعادة تنفيذ قد يكرر أثرها المالي. */
export class RecoverPackageSales {
  constructor(
    private readonly transactions: PackageSaleRecoveryTransactions,
    private readonly clock: PackageSaleClock,
  ) {}

  async execute(companyId: string): Promise<void> {
    const now = this.clock.now();
    const before = packageSaleStaleBefore(now);
    const at = now.toISOString();
    for (let page = 0; page < PACKAGE_SALE_RECOVERY_MAX_PAGES; page += 1) {
      const ids = await this.transactions.candidates(companyId, before);
      if (ids.length === 0) return;
      for (const id of ids) {
        await this.transactions.failStale(companyId, id, before, at);
      }
    }
  }
}
