import type { LeaveHistoryReportFailureCode } from '@pospay/contracts';
import { classifyLeaveHistoryReportError } from '../../domain/leave-history-report.ts';
import type {
  LeaveHistoryReportDiagnostics,
  LeaveHistoryReportTransactions,
} from '../../ports/leave-history-report.port.ts';

/** خطأ إعادة محاولة آمن؛ لا يحمل سبب السائق ولا تفاصيل التقرير إلى سجلات المهمة. */
export class LeaveHistoryReportRetryError extends Error {
  constructor(readonly failureCode?: LeaveHistoryReportFailureCode) {
    super('LEAVE_HISTORY_REPORT_RETRY');
    this.name = 'LeaveHistoryReportRetryError';
  }
}

/** يبني نتيجة التقرير المجمدة ويثبت الفشل الدائم مرة واحدة دون إعادة الحساب. */
export class BuildLeaveHistoryReport {
  constructor(
    private readonly transactions: LeaveHistoryReportTransactions,
    private readonly diagnostics?: LeaveHistoryReportDiagnostics,
  ) {}

  async execute(companyId: string, reportId: string): Promise<void> {
    try {
      await this.transactions.build(companyId, reportId);
    } catch (error) {
      if (error instanceof Error && error.name === 'CommitOutcomeUnknownError') {
        try {
          if (await this.settledAfterUnknownCommit(companyId, reportId)) return;
        } catch {
          await this.report(companyId, reportId, 'LEAVE_HISTORY_REPORT_RETRY');
          throw new LeaveHistoryReportRetryError();
        }
      }
      const decision = classifyLeaveHistoryReportError(error);
      await this.report(
        companyId,
        reportId,
        decision === 'RETRY' ? 'LEAVE_HISTORY_REPORT_RETRY' : decision,
      );
      if (decision !== 'RETRY') {
        await this.fail(companyId, reportId, decision);
        return;
      }
      throw new LeaveHistoryReportRetryError();
    }
  }

  // قراءة المنشئ للسجل فقط؛ تعثرها لا يغير قرار الفشل أو إعادة المحاولة.
  private async report(companyId: string, reportId: string, code: string): Promise<void> {
    if (!this.diagnostics) return;
    const createdBy = await this.transactions.readCreator(companyId, reportId).catch(() => null);
    this.diagnostics.failed({ companyId, reportId, createdBy, code });
  }

  private async settledAfterUnknownCommit(companyId: string, reportId: string): Promise<boolean> {
    const status = await this.transactions.readStatus(companyId, reportId);
    return status === null || status === 'ready' || status === 'failed';
  }

  async fail(
    companyId: string,
    reportId: string,
    code: LeaveHistoryReportFailureCode = 'LEAVE_HISTORY_REPORT_FAILED',
  ): Promise<void> {
    try {
      await this.transactions.fail(companyId, reportId, code);
    } catch {
      throw new LeaveHistoryReportRetryError(code);
    }
  }
}
