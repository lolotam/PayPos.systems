import type { OwnRatingSummary, OwnTips } from '@pospay/contracts';
import type { LinesView } from '../model/private-window-state';
import { monthOutOfRange } from '../model/work-error';
import { nextMonth, previousMonth } from '../model/work-month';
import { EstimateCard } from './estimate-card';
import { MonthStepper } from './month-stepper';
import { RatingSummaryCard } from './rating-summary-card';
import { TipsBlock } from './tips-block';
import { WorkLines } from './work-lines';

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
  estimateAllowed: boolean;
  onMonth: (month: string) => void;
  onRetry: () => void;
  onRetryTips: () => void;
  onLoadMore: () => void;
};

/**
 * محتوى «شغلي» الشكلي: الشهر، كارت التقدير، كارت التقييم، الإكراميات، وخدمات الشهر. بيتغذّى من react-query
 * على موبايلها الشخصي ومن متحكم النافذة على جهاز الاستقبال، ومعاه نفس العرض في الحالتين.
 * قاعدة AC-3-4: مسار rating-summary للجلسة الشخصية بس، فمفيش كارت تقييم على جهاز الاستقبال.
 * قاعدة AC-57-4-4 (معدّلة): كارت التقدير ما بيتعرضش من أي مدخل إنتاج لحد 57-5.
 * «السابق» بيتقفل وطلب الشهر لسه معلّق، فمفيش ضغطات متتالية تعدّي حد الشهور قبل ما السيرفر يرد 422.
 */
export function MyWorkCards(props: MyWorkCardsProps) {
  const { month, home, lines } = props;
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
        onPrevious={() => month && props.onMonth(previousMonth(month))}
        onNext={() => month && props.onMonth(nextMonth(month))}
      />
      <EstimateCard allowed={props.estimateAllowed} />
      <RatingSummaryCard summary={props.rating} />
      <TipsBlock tips={props.tips} failed={props.tipsFailed} onRetry={props.onRetryTips} />
      <WorkLines lines={lines} onRetry={props.onRetry} onLoadMore={props.onLoadMore} />
    </div>
  );
}
