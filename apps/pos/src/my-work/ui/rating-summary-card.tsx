import type { OwnRatingSummary } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

/**
 * كارت متوسط تقييمها في الشهر الحالي مع عدد التقييمات؛ لو مفيش تقييمات بيقول كده. لو العمود مخفي
 * (HIDDEN) أو الرد لسه ما جاش مفيش كارت خالص؛ ومفيش تعليق ولا عميلة ولا نجوم ولا رقم موظفة تانية (RT-25).
 *
 * @param props.summary رد ملخص التقييم
 */
export function RatingSummaryCard({ summary }: { summary: OwnRatingSummary | undefined }) {
  const locale = useLocale();
  if (summary?.visibility !== 'VISIBLE') return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(locale, 'myWork.ratingTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        {summary.average === null ? (
          <p role="status">{t(locale, 'myWork.ratingNone')}</p>
        ) : (
          <dl className="grid grid-cols-2 gap-2">
            <dt>{t(locale, 'myWork.ratingAverage')}</dt>
            <dd className="tabular-nums">{summary.average}</dd>
            <dt>{t(locale, 'myWork.ratingCount')}</dt>
            <dd className="tabular-nums">{summary.count}</dd>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
