import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { LinesView } from '../model/private-window-state';
import { invalidCursor } from '../model/work-error';

/**
 * زر «عرض المزيد» تحت الصفحات المحمّلة. لو تحميل صفحة إضافية فشل (نقل أو سيرفر) الصفحات اللي ظاهرة بتفضل،
 * وبيظهر الخطأ جنب الزر نفسه، والزر بيجرّب نفس المؤشر تاني.
 * المؤشر المرفوض (400 VALIDATION_FAILED) استثناء: تكرار نفس المؤشر مرفوض تاني، فالإعادة بترسم من الصفحة الأولى.
 *
 * @param props.lines حالة الصفحات
 * @param props.onLoadMore الصفحة التالية بالـ cursor
 * @param props.onRetry إعادة قراءة الصفحة الأولى
 */
export function WorkLinesMore({
  lines,
  onLoadMore,
  onRetry,
}: {
  lines: LinesView;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  const locale = useLocale();
  if (!lines.pages.at(-1)?.next_cursor) return null;
  const failed = lines.moreError !== undefined && !lines.fetchingMore;
  const expired = failed && invalidCursor(lines.moreError);
  return (
    <div className="grid gap-2">
      {failed ? <p role="alert">{t(locale, 'myWork.failed')}</p> : null}
      <Button
        variant="outline"
        disabled={lines.fetchingMore}
        onClick={expired ? onRetry : onLoadMore}
      >
        {t(locale, failed ? 'myWork.retry' : 'myWork.loadMore')}
      </Button>
    </div>
  );
}
