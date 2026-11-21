'use client';
import type { CustomerPackageListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { CustomerPackageCard } from './customer-package-card';

/**
 * قايمة باقات العميلة: ترتيب الخادم بيفضل زي ما هو، والصفحات بتتضاف على الطلب
 * ومن غير ما باقة تتكرر (الإزالة بيها في الـ hook نفسه). حالات القايمة منفصلة عن التفصيل (FR-A07).
 * خطأ تصفحة عابر (مش 401/403) بيفضل الصفحات المصرّح بها ظاهرة مع إعادة محاولة للصفحة الجاية بس
 * (أو إعادة أول تحميل لو مفيش صفحات لسه)، والرفض (401/403) بيخفي البيانات كلها.
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
  if (state === 'error' && errorMessage !== 'loadFailed') {
    const messageKey =
      errorMessage === 'notAllowed' ? 'customerPackages.notAllowed' : 'customerPackages.notFound';
    return <p role="alert">{t(locale, messageKey)}</p>;
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
      {state === 'error' ? (
        // خطأ عابر: الصفحات المصرّح بها بتفضل ظاهرة، والإعادة بتجيب الصفحة الجاية بس — أو تعيد
        // أول تحميل لو مفيش صفحات محفوظة لسه.
        <p role="alert">
          {t(locale, 'customerPackages.loadFailed')}{' '}
          <Button type="button" variant="outline" onClick={items.length === 0 ? onRetry : onMore}>
            {t(locale, 'customerPackages.retry')}
          </Button>
        </p>
      ) : null}
      {hasMore && state !== 'error' ? (
        <Button type="button" variant="outline" onClick={onMore}>
          {t(locale, 'customerPackages.loadMore')}
        </Button>
      ) : null}
    </>
  );
}
