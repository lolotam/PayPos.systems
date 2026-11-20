'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

// أزرار اللوحة الختامية: إعادة التحميل بتلمس نتايج الحفظ والقفل وترجّع أحدث سجل، والرجوع يقفل اللوحة.
export function ServiceEditActions({
  pending,
  onReload,
  onClose,
}: {
  pending: boolean;
  onReload: () => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex gap-2">
      <Button variant="outline" disabled={pending} onClick={onReload}>
        {t(locale, 'catalogServices.reload')}
      </Button>
      <Button variant="ghost" onClick={onClose}>
        {t(locale, 'catalogServices.cancel')}
      </Button>
    </div>
  );
}
