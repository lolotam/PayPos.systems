import type { OwnTips } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

/**
 * إكراميات الموظفة نفسها حسب الطريقة؛ لو العمود مخفي (أو لسه محملناش) مفيش بلوك (MY-08). فشل القراءة نفسها
 * (غير المخفي) بيظهر خطأ بإعادة محاولة، عشان الفشل ما يتشافش كأن الإكراميات مخفية بقرار الصلاحيات.
 *
 * @param props.tips رد الإكراميات
 * @param props.failed القراءة فشلت
 * @param props.onRetry إعادة قراءة الإكراميات بس
 */
export function TipsBlock({
  tips,
  failed,
  onRetry,
}: {
  tips: OwnTips | undefined;
  failed: boolean;
  onRetry: () => void;
}) {
  const locale = useLocale();
  if (failed)
    return (
      <div role="alert" className="flex items-center justify-between gap-2">
        <span>{t(locale, 'myWork.failed')}</span>
        <Button variant="outline" onClick={onRetry}>
          {t(locale, 'myWork.retry')}
        </Button>
      </div>
    );
  if (tips?.status !== 'VISIBLE') return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(locale, 'myWork.tipsTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-2">
          <dt>{t(locale, 'myWork.tipsCash')}</dt>
          <dd className="tabular-nums">{tips.total_cash}</dd>
          <dt>{t(locale, 'myWork.tipsCard')}</dt>
          <dd className="tabular-nums">{tips.total_card}</dd>
        </dl>
      </CardContent>
    </Card>
  );
}
