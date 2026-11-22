import { t } from '@pospay/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

/**
 * كارت التقدير: حالة «لسه مش جاهز» بس؛ المبلغ بيتوصل في 57-5. لو العمود غير مسموح مفيش كارت خالص.
 *
 * @param props.allowed هل `estimated_commission` مسموح للأعمدة
 */
export function EstimateCard({ allowed }: { allowed: boolean }) {
  const locale = useLocale();
  if (!allowed) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(locale, 'myWork.estimateTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <p role="status">{t(locale, 'myWork.estimatePending')}</p>
      </CardContent>
    </Card>
  );
}
