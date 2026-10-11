'use client';
import type { AttendanceBoard } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Badge } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
export function AttendanceSourceBadge({
  source,
}: {
  source: AttendanceBoard['sessions'][number]['source'];
}) {
  const locale = useLocale();
  return (
    <Badge title={source === 'MANUAL' ? t(locale, 'attendanceBoard.manualDetail') : undefined}>
      {t(locale, `attendanceBoard.${source}`)}
    </Badge>
  );
}
