import type { LeaveHistoryReportCleanupTransactions } from '../../ports/leave-history-report.port.ts';

const CLEANUP_BATCH_LIMIT = 50;

/** ينظف نتائج الشركة المنتهية على دفعات قصيرة ويترك المقفل منها للدورة التالية. */
export class CleanLeaveHistoryReports {
  constructor(private readonly transactions: LeaveHistoryReportCleanupTransactions) {}

  async execute(companyId: string): Promise<void> {
    try {
      for (let batch = 0; batch < CLEANUP_BATCH_LIMIT; batch += 1) {
        const deleted = await this.transactions.deleteExpired(companyId);
        if (deleted === 0) return;
      }
    } catch {
      throw new Error('LEAVE_HISTORY_REPORT_CLEANUP_RETRY');
    }
  }
}
