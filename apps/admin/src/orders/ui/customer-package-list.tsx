'use client';
import type { CustomerPackageListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { CustomerPackageCard } from './customer-package-card';

/**
 * قايمة باقات العميلة: ترتيب الخادم بيفضل زي ما هو، والصفحات بتتضاف على الطلب
 * ومن غير ما باقة تتكرر (الإزالة بيها في الـ hook نفسه). حالات القايمة منفصلة عن التفصيل (FR-A07).
 */
export function CustomerPackageList({
  items,
  state,
  errorMessage,
  hasMore,
  onRetry,
  onMore,
  onSelect,
  selectedId,
}: {
  items: readonly CustomerPackageListItem[];
  state: 'loading' | 'empty' | 'ready' | 'error';
  errorMessage: 'notAllowed' | 'notFound' | 'loadFailed' | null;
  hasMore: boolean;
  onRetry: () => void;
  onMore: () => void;
  onSelect: (entitlementId: string) => void;
  selectedId: string | null;
}) {
  const locale = useLocale();
  if (state === 'loading') return <p role="status">{t(locale, 'customerPackages.loading')}</p>;
  if (state === 'error') {
    const messageKey =
      errorMessage === 'notAllowed'
        ? 'customerPackages.notAllowed'
        : errorMessage === 'notFound'
          ? 'customerPackages.notFound'
          : 'customerPackages.loadFailed';
    return (
      <p role="alert">
        {t(locale, messageKey)}{' '}
        {errorMessage === 'loadFailed' ? (
          <Button type="button" variant="outline" onClick={onRetry}>
            {t(locale, 'customerPackages.retry')}
          </Button>
        ) : null}
      </p>
    );
  }
  if (state === 'empty') return <p role="status">{t(locale, 'customerPackages.empty')}</p>;
  return (
    <>
      {items.map((item) => (
        <CustomerPackageCard
          key={item.id}
          item={item}
          selected={selectedId === item.id}
          onSelect={onSelect}
        />
      ))}
      {hasMore ? (
        <Button type="button" variant="outline" onClick={onMore}>
          {t(locale, 'customerPackages.loadMore')}
        </Button>
      ) : null}
    </>
  );
}
