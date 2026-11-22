import { useState } from 'react';
import type { PrivateViewAccess } from '../api/use-private-view';
import { useRatingSummary, useWorkLines, useWorkTips } from '../api/use-my-work';
import { monthOutOfRange } from '../model/work-error';
import type { WorkContext } from '../model/work-context';
import { nextMonth, previousMonth } from '../model/work-month';
import { EstimateCard } from './estimate-card';
import { MonthStepper } from './month-stepper';
import { RatingSummaryCard } from './rating-summary-card';
import { TipsBlock } from './tips-block';
import { WorkLines } from './work-lines';

/**
 * محتوى «شغلي» جوّا البوابة الخاصة: الشهر، كارت التقدير، كارت التقييم، الإكراميات، وخدمات الشهر.
 * كارت التقييم بياخد نفس `access` عشان يفضل جوّا النافذة، وبيتقرا للموبايل الشخصي بس.
 * قاعدة AC-3-4: مسار rating-summary للجلسة الشخصية بس (جهاز الاستقبال بياخد 401، وread:ratings:own ممنوعة
 * للأجهزة)، فمفيش كارت تقييم ولا طلب تقييم على جهاز الاستقبال؛ إظهاره هناك متابعة منفصلة.
 *
 * @param props.context مين بيفتح الشاشة
 * @param props.access رقم النافذة ومعالج الرفض من البوابة
 * @param props.estimateAllowed قاعدة AC-57-4-4 (معدّلة): كارت التقدير ما بيتعرضش من أي مدخل إنتاج لحد 57-5
 *   (مفيش قراءة في الـ POS لأعمدة الموظفة المسموحة)، والكارت متختبر على مستوى المكوّن بس
 */
export function MyWorkCards({
  context,
  access,
  estimateAllowed,
}: {
  context: WorkContext;
  access: PrivateViewAccess;
  estimateAllowed: boolean;
}) {
  // undefined = الشهر الحالي زي ما السيرفر بيحدده؛ المتصفح ما بيحسبوش من ساعته.
  const [month, setMonth] = useState<string>();
  const [home, setHome] = useState<string>();
  const lines = useWorkLines(context, month, access);
  const tips = useWorkTips(context, month, access);
  const rating = useRatingSummary(context, access, context.mode === 'personal');
  const serverMonth = lines.data?.pages[0]?.month;
  if (month === undefined && serverMonth !== undefined && home !== serverMonth)
    setHome(serverMonth);
  const shown = month ?? serverMonth;
  return (
    <div className="grid gap-4">
      <MonthStepper
        month={shown}
        canGoBack={shown !== undefined && !monthOutOfRange(lines.error)}
        canGoForward={shown !== undefined && home !== undefined && shown !== home}
        onPrevious={() => shown && setMonth(previousMonth(shown))}
        onNext={() => shown && setMonth(nextMonth(shown))}
      />
      <EstimateCard allowed={estimateAllowed} />
      <RatingSummaryCard summary={rating.data} />
      <TipsBlock tips={tips.data} />
      <WorkLines query={lines} />
    </div>
  );
}
