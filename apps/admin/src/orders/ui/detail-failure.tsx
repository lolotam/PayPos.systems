'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

/**
 * حالات فشل تفصيل الباقة المنفصلة عن القايمة (FR-A07): الرفض (403) و«غير موجودة» (404) بيقفلوا بزر،
 * والفشل العابر بيجيب إعادة محاولة من غير أي طلب جديد لحالة رفض.
 */
export function DetailFailure({
  mode,
  onRetry,
  onClose,
}: {
  mode: 'refused' | 'missing' | 'transient';
  onRetry: () => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  const messageKey =
    mode === 'refused'
      ? 'customerPackages.detailNotAllowed'
      : mode === 'missing'
        ? 'customerPackages.detailNotFound'
        : 'customerPackages.detailLoadFailed';
  return (
    <p role="alert">
      {t(locale, messageKey)}{' '}
      {mode === 'transient' ? (
        <Button type="button" variant="outline" onClick={onRetry}>
          {t(locale, 'customerPackages.detailRetry')}
        </Button>
      ) : null}
      <Button type="button" variant="outline" onClick={onClose}>
        {t(locale, 'customerPackages.close')}
      </Button>
    </p>
  );
}
