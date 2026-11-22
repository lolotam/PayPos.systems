import type { OwnTips } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

/**
 * إكراميات الموظفة نفسها حسب الطريقة؛ لو العمود مخفي (أو لسه محملناش) مفيش بلوك (MY-08).
 *
 * @param props.tips رد الإكراميات
 */
export function TipsBlock({ tips }: { tips: OwnTips | undefined }) {
  const locale = useLocale();
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
