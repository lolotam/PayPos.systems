'use client';
import type { useAttendanceStatementDownload } from '../api/use-attendance-statement-download';
import type { useAttendanceStatementRequest } from '../api/use-attendance-statement-request';
import type { useAttendanceStatementStatus } from '../api/use-attendance-statement-status';
import {
  statementCollectCanRecover,
  statementExpired,
} from '../model/attendance-statement-display';
import { AttendanceStatementProgress } from './attendance-statement-progress';

/** نتيجة طلب الكشف تحت بطاقة النموذج: حالة التجهيز والتنزيل وإجراءات الاستعادة. */
export function AttendanceStatementOutcome({
  request,
  status,
  download,
  checkingAgain,
  onCheckAgain,
  onNewRequest,
}: {
  request: ReturnType<typeof useAttendanceStatementRequest>;
  status: ReturnType<typeof useAttendanceStatementStatus>;
  download: ReturnType<typeof useAttendanceStatementDownload>;
  checkingAgain: boolean;
  onCheckAgain: () => void;
  onNewRequest: () => void;
}) {
  const expired = statementExpired(status.error) || statementExpired(download.error);
  const collectRecovery = statementCollectCanRecover(download.error ?? status.error);
  return (
    <AttendanceStatementProgress
      state={checkingAgain ? undefined : status.data?.state}
      errorCode={status.data?.error_code}
      error={request.error ?? download.error ?? status.error}
      errorRoute={request.error ? 'request' : 'render'}
      waiting={request.data?.render_id !== undefined}
      showCheckAgain={!expired && (collectRecovery || status.timedOut)}
      collected={download.isSuccess}
      downloading={download.isPending}
      showNewRequest={expired || collectRecovery}
      onDownload={() => download.mutate()}
      onCheckAgain={onCheckAgain}
      onNewRequest={onNewRequest}
    />
  );
}
