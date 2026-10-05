import { importCommitStaleBefore } from '../../domain/employee-import-recovery.ts';
import type { ImportRecoveryTransactions } from '../../ports/employee-import-recovery.port.ts';
import type { Clock } from '../../ports/clock.port.ts';

// يفشل الطلبات العالقة بدلاً من إعادة إرسال إنشاء قد يكرر أثره بعد فقد الوظيفة.
export class RecoverEmployeeImports {
  constructor(
    private readonly transactions: ImportRecoveryTransactions,
    private readonly clock: Clock,
  ) {}

  async execute(companyId: string): Promise<void> {
    const before = importCommitStaleBefore(this.clock.now());
    for (;;) {
      const ids = await this.transactions.candidates(companyId, before);
      if (ids.length === 0) return;
      for (const id of ids) await this.transactions.failStale(companyId, id, before);
    }
  }
}
