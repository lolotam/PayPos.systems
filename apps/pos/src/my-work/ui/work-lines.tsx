import { t } from '@pospay/i18n';
import { Button, EmptyState } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { useWorkLines } from '../api/use-my-work';
import { monthOutOfRange, workForbidden } from '../model/work-error';
import { WorkLineRow } from './work-line-row';

/**
 * قائمة خدمات الشهر بحالاتها: تحميل، شهر خارج الحد، ممنوع، فشل مع إعادة، فاضي، والمزيد بالـ cursor.
 *
 * @param props.query استعلام الصفحات
 * @param props.timezone توقيت الفرع لو الجهاز عارفه
 */
export function WorkLines({
  query,
  timezone,
}: {
  query: ReturnType<typeof useWorkLines>;
  timezone?: string;
}) {
  const locale = useLocale();
  const status = (key: 'loading' | 'outOfRange' | 'refused' | 'empty') => (
    <p role="status">{t(locale, `myWork.${key}`)}</p>
  );
  if (query.isPending) return status('loading');
  if (query.isError) {
    if (monthOutOfRange(query.error)) return status('outOfRange');
    if (workForbidden(query.error)) return status('refused');
    return (
      <EmptyState
        role="alert"
        tone="danger"
        icon={null}
        title={t(locale, 'myWork.failed')}
        action={<Button onClick={() => void query.refetch()}>{t(locale, 'myWork.retry')}</Button>}
      />
    );
  }
  const items = query.data.pages.flatMap((page) => page.items);
  if (items.length === 0) return status('empty');
  return (
    <>
      <ul className="grid gap-3">
        {items.map((item) => (
          <WorkLineRow key={item.line_id} item={item} {...(timezone ? { timezone } : {})} />
        ))}
      </ul>
      {query.hasNextPage ? (
        <Button
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t(locale, 'myWork.loadMore')}
        </Button>
      ) : null}
    </>
  );
}
