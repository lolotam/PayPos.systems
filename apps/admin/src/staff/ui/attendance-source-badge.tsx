'use client';
import type { AttendanceBoard } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Badge } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { attendanceActor } from '../model/attendance-action-display';
export function AttendanceSourceBadge({
  source,
  manual,
}: {
  source: AttendanceBoard['sessions'][number]['source'];
  manual?: AttendanceBoard['sessions'][number]['manual'];
}) {
  const locale = useLocale();
  return (
    <div className="grid gap-1">
      <Badge title={source === 'MANUAL' ? t(locale, 'attendanceBoard.manualDetail') : undefined}>
        {t(locale, `attendanceBoard.${source}`)}
      </Badge>
      {source === 'MANUAL' && manual ? (
        <p className="text-xs text-muted-foreground">
          {t(locale, 'attendanceActions.requestedBy')}:{' '}
          {attendanceActor(manual.requested_by_name, locale)} ·{' '}
          {t(locale, 'attendanceActions.approvedBy')}:{' '}
          {attendanceActor(manual.approved_by_name, locale)}
        </p>
      ) : null}
    </div>
  );
}
