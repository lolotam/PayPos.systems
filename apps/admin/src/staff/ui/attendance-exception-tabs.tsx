'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
export function AttendanceExceptionTabs({
  status,
  onStatus,
}: {
  status: 'OPEN' | 'RESOLVED';
  onStatus: (status: 'OPEN' | 'RESOLVED') => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex gap-2" role="group" aria-label={t(locale, 'attendanceBoard.status')}>
      {(['OPEN', 'RESOLVED'] as const).map((next) => (
        <Button
          key={next}
          variant={status === next ? 'default' : 'outline'}
          aria-pressed={status === next}
          onClick={() => onStatus(next)}
        >
          {t(locale, `attendanceActions.${next}`)}
        </Button>
      ))}
    </div>
  );
}
