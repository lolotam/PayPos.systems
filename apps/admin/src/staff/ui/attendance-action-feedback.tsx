'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { attendanceActionError } from '../model/attendance-action-display';
export function AttendanceActionFeedback({
  error,
  loading = false,
  saved = false,
  onRetry,
}: {
  error?: unknown;
  loading?: boolean;
  saved?: boolean;
  onRetry?: () => void;
}) {
  const locale = useLocale();
  if (loading) return <p role="status">{t(locale, 'admin.loading')}</p>;
  if (error)
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2">
        <p>{attendanceActionError(error, locale)}</p>
        {onRetry ? (
          <Button type="button" variant="outline" onClick={onRetry}>
            {t(locale, 'attendanceBoard.retry')}
          </Button>
        ) : null}
      </div>
    );
  return saved ? <p role="status">{t(locale, 'attendanceActions.saved')}</p> : null;
}
