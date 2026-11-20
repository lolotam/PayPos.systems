'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

// تأكيد القفل مرة واحدة جوه الكتلة (نمط 3a من غير دايلوج): نص واحد وزرارين، والتنفيذ بتعطّلهم؛
// والتأكيد بيتعطل كمان وفيه تعديلات متحفظاش عشان القفل ما يمسحهاش بتغيير النسخة.
export function ServiceClosingConfirm({
  pending,
  dirty,
  onConfirm,
  onCancel,
}: {
  pending: boolean;
  dirty: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-2">
      <p>{t(locale, 'catalogServices.closeServiceConfirm')}</p>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || dirty} onClick={onConfirm}>
          {t(locale, 'catalogServices.closeServiceConfirmAction')}
        </Button>
        <Button variant="outline" size="sm" disabled={pending} onClick={onCancel}>
          {t(locale, 'catalogServiceCategories.cancel')}
        </Button>
      </div>
    </div>
  );
}
