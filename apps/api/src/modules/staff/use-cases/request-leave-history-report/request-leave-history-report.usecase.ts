import {
  LEAVE_HISTORY_REPORT_RETENTION_MS,
  type LeaveHistoryReportRequest,
} from '@pospay/contracts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import {
  LEAVE_HISTORY_REPORT_MAX_PENDING,
  LeaveHistoryReportRequestError,
  leaveHistoryReportFingerprintSource,
  normalizeLeaveHistoryReportQuery,
  pendingLeaveHistoryReport,
  type LeaveHistoryReportActor,
} from '../../domain/leave-history-report-request.ts';
import type { LeaveHistoryReportRequestTransactions } from '../../ports/leave-history-report-request.port.ts';

// يقبل تقرير سجل الإجازات الثقيل بإعادة استخدام المعلق المطابق أو إنشاء صف وحدث واحد.
export class RequestLeaveHistoryReportUseCase {
  constructor(
    private readonly transactions: LeaveHistoryReportRequestTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  execute(command: LeaveHistoryReportActor & LeaveHistoryReportRequest) {
    return this.transactions.run(command, async (scope) => {
      const frozenScope = await scope.authorize(command.branch_id);
      const query = normalizeLeaveHistoryReportQuery(command);
      const fingerprintSource = leaveHistoryReportFingerprintSource(query, frozenScope);
      await scope.lockCreator();
      const now = this.clock.now();
      const reusable = await scope.findReusablePending(fingerprintSource, now);
      if (reusable !== null) return { report_id: reusable };
      if ((await scope.countPending(now)) >= LEAVE_HISTORY_REPORT_MAX_PENDING)
        throw new LeaveHistoryReportRequestError('LEAVE_HISTORY_REPORT_BUSY');
      const pending = {
        ...pendingLeaveHistoryReport(this.ids.newId(), now, LEAVE_HISTORY_REPORT_RETENTION_MS),
        query,
        scope: frozenScope,
        fingerprintSource,
      };
      await scope.createPending(pending);
      await scope.publishRequested(pending.id);
      return { report_id: pending.id };
    });
  }
}

export { LeaveHistoryReportRequestError } from '../../domain/leave-history-report-request.ts';
