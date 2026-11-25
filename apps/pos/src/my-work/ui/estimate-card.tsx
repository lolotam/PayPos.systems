import type { OwnCommissionCorrection, OwnCommissionEstimate } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { formatBusinessDate } from '../model/work-format';

function correctionService(correction: OwnCommissionCorrection, locale: Locale): string | null {
  if (correction.kind !== 'LINE') return null;
  const arabic = correction.service_name_ar;
  return locale === 'ar' && arabic ? arabic : (correction.service_name_en ?? arabic);
}

/** تصحيح واحد زي ما المدير بيشوفه: شهر المصدر واليوم والخدمة (للبند بس) وكان وأصبح والفرق؛ مفيش أي بيانات عميل (CS-Q30). */
function CorrectionRow({ correction }: { correction: OwnCommissionCorrection }) {
  const locale = useLocale();
  const service = correctionService(correction, locale);
  const field = (label: string, value: string) => (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </>
  );
  return (
    <li>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        {field(t(locale, 'myWork.correctionSourceMonth'), correction.source_period)}
        {correction.business_date === null
          ? null
          : field(t(locale, 'myWork.date'), formatBusinessDate(correction.business_date, locale))}
        {service === null ? null : field(t(locale, 'myWork.service'), service)}
        {field(t(locale, 'myWork.correctionWas'), correction.previous_amount)}
        {field(t(locale, 'myWork.correctionNow'), correction.new_amount)}
        {field(t(locale, 'myWork.correctionDiff'), correction.amount)}
      </dl>
    </li>
  );
}

function Corrections({ corrections }: { corrections: readonly OwnCommissionCorrection[] }) {
  const locale = useLocale();
  if (corrections.length === 0) return null;
  return (
    <section className="grid gap-2">
      <h4>{t(locale, 'myWork.correctionTitle')}</h4>
      <ul className="grid gap-3">
        {corrections.map((correction, index) => (
          <CorrectionRow
            key={`${correction.source_period}-${correction.kind}-${correction.business_date ?? 'none'}-${index}`}
            correction={correction}
          />
        ))}
      </ul>
    </section>
  );
}

function EstimateBody({
  estimate,
}: {
  estimate: Exclude<OwnCommissionEstimate, { status: 'HIDDEN' }>;
}) {
  const locale = useLocale();
  const total = (label: string, amount: string) => (
    <p>
      <span className="text-muted-foreground">{label}</span>{' '}
      <span className="tabular-nums">{amount}</span>
    </p>
  );
  switch (estimate.status) {
    case 'ESTIMATE':
      return (
        <>
          {total(t(locale, 'myWork.estimateTotal'), estimate.total)}
          {estimate.recalculated ? (
            <p role="status">{t(locale, 'myWork.estimateRecalculated')}</p>
          ) : null}
        </>
      );
    case 'APPROVED':
      return (
        <>
          <Badge>{t(locale, 'myWork.estimateApproved')}</Badge>
          {total(t(locale, 'myWork.estimateApprovedAmount'), estimate.total)}
        </>
      );
    default:
      return <p role="status">{t(locale, 'myWork.estimateNoPlan')}</p>;
  }
}

/**
 * كارت العمولة (MY-05، MY-06، CS-Q30): الإجمالي التقديري أو المعتمد، أو «مفيش خطة عمولة لسه» بلا أي رقم، مع
 * تصحيحات الشهر لو فيه. من غير رد أو مع HIDDEN مفيش كارت خالص.
 *
 * @param props.estimate رد التقدير المثبت للشهر المعروض، أو undefined لو لسه ما اتحمّلش أو اتمنع
 */
export function EstimateCard({ estimate }: { estimate: OwnCommissionEstimate | undefined }) {
  const locale = useLocale();
  if (estimate === undefined || estimate.status === 'HIDDEN') return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(locale, 'myWork.estimateTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <EstimateBody estimate={estimate} />
        <Corrections corrections={estimate.corrections} />
      </CardContent>
    </Card>
  );
}
