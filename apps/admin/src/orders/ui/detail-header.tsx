'use client';
import type { CustomerPackageDetail } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { provenanceKey } from '../model/customer-package-view';

/** رأس تفصيل الباقة: الاسم بلغة المستخدم والأصل وزر الإغلاق اللي بيمسح الاختيار من العنوان. */
export function DetailHeader({
  data,
  onClose,
}: {
  data: CustomerPackageDetail;
  onClose: () => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="font-semibold">
        {locale === 'ar' ? (data.name_ar ?? data.name_en) : data.name_en}
      </h2>
      <span>{t(locale, provenanceKey(data.provenance))}</span>
      <Button type="button" variant="outline" onClick={onClose}>
        {t(locale, 'customerPackages.close')}
      </Button>
    </div>
  );
}
