import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { monthOutOfRange, viewForbidden } from '@/shared/private-view/errors';

/**
 * حالة القراءة في «حضوري»: التحميل، أو الشهر خارج حد المنشأة (422)، أو رفض الصلاحية (403)، أو فشل عام
 * مع زر إعادة محاولة، أو الشهر الفاضي.
 *
 * @param props.status حالة القراءة
 * @param props.error آخر خطأ في القراءة
 * @param props.onRetry إعادة المحاولة
 */
export function AttendanceState({
  status,
  error,
  onRetry,
}: {
  status: 'pending' | 'ready' | 'error';
  error: unknown;
  onRetry: () => void;
}) {
  const locale = useLocale();
  if (status === 'pending') return <p role="status">{t(locale, 'myAttendance.loading')}</p>;
  if (status === 'ready') return null;
  if (monthOutOfRange(error)) return <p role="alert">{t(locale, 'myAttendance.outOfRange')}</p>;
  if (viewForbidden(error)) return <p role="alert">{t(locale, 'myAttendance.refused')}</p>;
  return (
    <div className="grid gap-2">
      <p role="alert">{t(locale, 'myAttendance.failed')}</p>
      <Button variant="outline" onClick={onRetry}>
        {t(locale, 'myAttendance.retry')}
      </Button>
    </div>
  );
}
