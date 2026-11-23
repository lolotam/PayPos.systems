import { t } from '@pospay/i18n';
import { Button, EmptyState } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { LinesView } from '../model/private-window-state';
import { monthOutOfRange, workForbidden } from '../model/work-error';
import { WorkLineRow } from './work-line-row';
import { WorkLinesMore } from './work-lines-more';

/**
 * قائمة خدمات الشهر بحالاتها: تحميل، شهر خارج الحد، ممنوع، فشل مع إعادة، فاضي، والمزيد بالـ cursor
 * (فشل «المزيد» بيسيب الصفحات ظاهرة وبيتعرض جنب الزر).
 *
 * الوقت وتاريخ الإلغاء بيتعرضوا بتوقيت النشاط اللي جاي مع كل صفحة، مش بتوقيت الجهاز (AC-57-4-9).
 *
 * @param props.lines حالة الصفحات (react-query أو المتحكم)
 * @param props.onRetry إعادة تحميل الصفحة الأولى
 * @param props.onLoadMore الصفحة التالية بالـ cursor
 */
export function WorkLines({
  lines,
  onRetry,
  onLoadMore,
}: {
  lines: LinesView;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  const locale = useLocale();
  const status = (key: 'loading' | 'outOfRange' | 'refused' | 'empty') => (
    <p role="status">{t(locale, `myWork.${key}`)}</p>
  );
  if (lines.status === 'pending') return status('loading');
  if (lines.status === 'error') {
    if (monthOutOfRange(lines.error)) return status('outOfRange');
    if (workForbidden(lines.error)) return status('refused');
    return (
      <EmptyState
        role="alert"
        tone="danger"
        icon={null}
        title={t(locale, 'myWork.failed')}
        action={<Button onClick={onRetry}>{t(locale, 'myWork.retry')}</Button>}
      />
    );
  }
  const items = lines.pages.flatMap((page) =>
    page.items.map((item) => ({ item, timeZone: page.time_zone })),
  );
  if (items.length === 0) return status('empty');
  return (
    <>
      <ul className="grid gap-3">
        {items.map(({ item, timeZone }) => (
          <WorkLineRow key={item.line_id} item={item} timeZone={timeZone} />
        ))}
      </ul>
      <WorkLinesMore lines={lines} onLoadMore={onLoadMore} />
    </>
  );
}
