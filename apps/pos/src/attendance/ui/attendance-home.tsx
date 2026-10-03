import { t } from '@pospay/i18n';
import { Button, Card, EmptyState, WifiOff, CircleAlert, LoaderCircle } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';
import { useAttendanceQr } from '../api/use-attendance-qr';
import { AttendanceQr } from './attendance-qr';
import { AttendanceClock } from './attendance-clock';

export function AttendanceHome({
  branchId,
  onRejected,
}: {
  branchId: string;
  onRejected: () => Promise<void>;
}) {
  const locale = useLocale();
  const qr = useAttendanceQr(branchId, onRejected);
  const name = locale === 'ar' ? (qr.branch?.name_ar ?? qr.branch?.name_en) : qr.branch?.name_en;
  return (
    <Card className="flex min-w-0 flex-col items-center gap-6 p-6 text-center sm:p-8">
      <h1 className="text-2xl font-bold">{t(locale, 'pos.attendanceTitle')}</h1>
      <p className="text-lg">
        <span>{t(locale, 'pos.branchLabel')}</span>
        <span className="ms-2 break-all font-bold">{name ?? branchId}</span>
      </p>
      {qr.now !== null && qr.branch !== undefined && (
        <AttendanceClock now={qr.now} timeZone={qr.branch.effective_timezone} />
      )}
      {qr.payload !== null ? (
        <AttendanceQr payload={qr.payload} />
      ) : (
        <EmptyState
          role="status"
          className="w-full"
          tone={
            qr.notice === 'offline' ? 'warning' : qr.notice === 'unavailable' ? 'danger' : 'neutral'
          }
          icon={
            qr.notice === 'offline' ? (
              <WifiOff />
            ) : qr.notice === 'unavailable' ? (
              <CircleAlert />
            ) : (
              <LoaderCircle />
            )
          }
          title={t(
            locale,
            qr.notice === 'offline'
              ? 'pos.attendanceOffline'
              : qr.notice === 'unavailable'
                ? 'pos.attendanceUnavailable'
                : 'pos.attendanceLoading',
          )}
          action={
            <Button variant="secondary" onClick={qr.retry}>
              {t(locale, 'pos.retry')}
            </Button>
          }
        />
      )}
      <p className="text-base text-muted-foreground">{t(locale, 'pos.attendanceRefreshLead')}</p>
    </Card>
  );
}
