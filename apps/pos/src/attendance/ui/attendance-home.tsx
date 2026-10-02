import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';

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
    <section className="flex flex-col gap-6 text-center">
      <h1 className="text-start text-lg font-bold">{t(locale, 'pos.attendanceTitle')}</h1>
      <p className="text-start text-sm">
        <span>{t(locale, 'pos.branchLabel')}</span>
        <span className="ms-2">{name ?? branchId}</span>
      </p>
      {qr.now !== null && qr.branch !== undefined && (
        <AttendanceClock now={qr.now} timeZone={qr.branch.effective_timezone} />
      )}
      {qr.payload !== null ? (
        <AttendanceQr payload={qr.payload} />
      ) : (
        <div role="status" className="flex flex-col items-center gap-4">
          <p>
            {t(
              locale,
              qr.notice === 'offline'
                ? 'pos.attendanceOffline'
                : qr.notice === 'unavailable'
                  ? 'pos.attendanceUnavailable'
                  : 'pos.attendanceLoading',
            )}
          </p>
          <Button onClick={qr.retry}>{t(locale, 'pos.retry')}</Button>
        </div>
      )}
      <p className="text-sm text-muted-foreground">{t(locale, 'pos.attendanceRefreshLead')}</p>
    </section>
  );
}
