import { t } from '@pospay/i18n';
import { Button, Card, CardContent } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

/**
 * لوحة تأكيد تبديل النشاط.
 *
 * مش نافذة منبثقة ولا بوابة: اللوحة بتتعرض فوق الشاشة الشخصية نفسها، عشان
 * الموظفة تشوف الشاشة اللي هتسيبها وهي بتأكد. ومفيش فيها ذكر لتغيير نوع
 * الجهاز: ده قرار تاني وله لغته (FR-008).
 */
export function SwitchBusinessPanel({
  busy,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const locale = useLocale();
  return (
    <Card className="mx-auto mt-4 w-full max-w-md">
      <CardContent className="grid gap-3">
        <p>{t(locale, 'nativeShell.switchBusinessConfirm')}</p>
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={busy} onClick={onConfirm}>
            {t(locale, 'nativeShell.confirm')}
          </Button>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            {t(locale, 'nativeShell.cancel')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
