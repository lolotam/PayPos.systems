'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
export function AttendanceActionPagination({
  hasMore,
  fetching,
  onMore,
}: {
  hasMore: boolean;
  fetching: boolean;
  onMore: () => void;
}) {
  const locale = useLocale();
  return hasMore ? (
    <Button variant="outline" disabled={fetching} onClick={onMore}>
      {t(locale, 'attendanceBoard.loadMore')}
    </Button>
  ) : null;
}
