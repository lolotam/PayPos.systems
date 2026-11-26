import type { OwnCommissionEstimate, OwnRatingSummary, OwnTips } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { MonthStepper } from '@/shared/month/month-stepper';
import { nextMonth, previousMonth } from '@/shared/month/month';
import { useLocale } from '@/shared/locale/locale-context';
import type { LinesView } from '../model/private-window-state';
import { monthOutOfRange } from '../model/work-error';
import { EstimateCard } from './estimate-card';
import { RatingSummaryCard } from './rating-summary-card';
import { TipsBlock } from './tips-block';
import { WorkLines } from './work-lines';

// الوصول لآخر شهر مسجّل بيرجع للطلب من غير شهر: لو الشهر اتغيّر والشاشة مفتوحة السيرفر هو اللي يسمّي الجديد.
const forward = (month: string, home: string | undefined) => {
  const next = nextMonth(month);
  return next === home ? undefined : next;
};

export type MyWorkCardsProps = {
  /** الشهر المعروض (المطلوب أو شهر السيرفر)، أو undefined قبل أول رد. */
  month: string | undefined;
  /** الشهر الحالي من السيرفر، لقفل زر «التالي». */
  home: string | undefined;
  lines: LinesView;
  tips: OwnTips | undefined;
  /** قراءة الإكراميات فشلت (مش مخفية): بيظهر خطأ صغير بإعادة محاولة بدل ما البلوك يختفي. */
  tipsFailed: boolean;
  /** ملخص التقييم: موبايلها الشخصي بس (AC-3-4)، وجهاز الاستقبال بيبعت undefined. */
  rating: OwnRatingSummary | undefined;
  /** تقدير العمولة المثبت للشهر المعروض؛ undefined أو HIDDEN = مفيش كارت ولا عمولة بند. */
  estimate: OwnCommissionEstimate | undefined;
  /** undefined = الشهر الحالي من غير شهر صريح، عشان السيرفر يسمّيه تاني لو الشهر اتغيّر والشاشة مفتوحة. */
  onMonth: (month: string | undefined) => void;
  onRetry: () => void;
  onRetryTips: () => void;
  onLoadMore: () => void;
};

/**
 * محتوى «شغلي» الشكلي: الشهر، كارت التقدير، كارت التقييم، الإكراميات، وخدمات الشهر. بيتغذّى من react-query
 * على موبايلها الشخصي ومن متحكم النافذة على جهاز الاستقبال، ومعاه نفس العرض في الحالتين.
 * قاعدة AC-3-4: مسار rating-summary للجلسة الشخصية بس، فمفيش كارت تقييم على جهاز الاستقبال.
 * عمولة البند بتتعرض من `per_line` لما التقدير ESTIMATE بس (MY-05)، والكارت نفسه من رد التقدير.
 * «السابق» بيتقفل وطلب الشهر لسه معلّق، فمفيش ضغطات متتالية تعدّي حد الشهور قبل ما السيرفر يرد 422.
 */
export function MyWorkCards(props: MyWorkCardsProps) {
  const { month, home, lines, estimate } = props;
  const locale = useLocale();
  const lineCommissions =
    estimate?.status === 'ESTIMATE'
      ? new Map(estimate.per_line.map((line) => [line.line_id, line.amount]))
      : undefined;
  return (
    <div className="grid gap-4">
      <MonthStepper
        month={month}
        canGoBack={
          month !== undefined &&
          lines.status !== 'pending' &&
          !(lines.status === 'error' && monthOutOfRange(lines.error))
        }
        canGoForward={month !== undefined && home !== undefined && month !== home}
        labels={{
          previous: t(locale, 'myWork.previousMonth'),
          next: t(locale, 'myWork.nextMonth'),
        }}
        onPrevious={() => month && props.onMonth(previousMonth(month))}
        onNext={() => month && props.onMonth(forward(month, home))}
      />
      <EstimateCard estimate={estimate} />
      <RatingSummaryCard summary={props.rating} />
      <TipsBlock tips={props.tips} failed={props.tipsFailed} onRetry={props.onRetryTips} />
      <WorkLines
        lines={lines}
        lineCommissions={lineCommissions}
        onRetry={props.onRetry}
        onLoadMore={props.onLoadMore}
      />
    </div>
  );
}
