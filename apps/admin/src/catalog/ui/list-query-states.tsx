'use client';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { t } from '@pospay/i18n';
import { CircleAlert, EmptyState, LoaderCircle, Store } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';

type Listed = { items: readonly unknown[] };

/** حالات القائمة الثلاث داخل كرت القائمة: تحميل، خطأ، فراغ؛ وعند وجود صفوف يُرسم الجدول بالبيانات. */
export function ListQueryStates<T extends Listed>({
  list,
  emptyTitle,
  children,
}: {
  list: UseQueryResult<T>;
  emptyTitle: string;
  children: (data: T) => ReactNode;
}) {
  const locale = useLocale();
  if (list.isPending)
    return <EmptyState role="status" icon={<LoaderCircle />} title={t(locale, 'admin.loading')} />;
  if (list.isError)
    return (
      <EmptyState
        role="alert"
        tone="danger"
        icon={<CircleAlert />}
        title={envelopeMessage(list.error, locale)}
      />
    );
  if (list.data.items.length === 0) return <EmptyState icon={<Store />} title={emptyTitle} />;
  return children(list.data);
}
