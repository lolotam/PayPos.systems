import { useState } from 'react';
import type { PrivateViewAccess } from '../api/use-private-view';
import { useWorkLines, useWorkTips } from '../api/use-my-work';
import { monthOutOfRange } from '../model/work-error';
import type { WorkContext } from '../model/work-context';
import { nextMonth, previousMonth } from '../model/work-month';
import { EstimateCard } from './estimate-card';
import { MonthStepper } from './month-stepper';
import { TipsBlock } from './tips-block';
import { WorkLines } from './work-lines';

/**
 * محتوى «شغلي» جوّا البوابة الخاصة: الشهر، كارت التقدير، الإكراميات، وخدمات الشهر.
 * كارت التقييم (61-3) بيتضاف هنا بعد EstimateCard وياخد نفس `access` عشان يفضل جوّا النافذة.
 *
 * @param props.context مين بيفتح الشاشة
 * @param props.access رقم النافذة ومعالج الرفض من البوابة
 * @param props.estimateAllowed TODO(spec): مفيش مصدر في الـ POS لـ `estimated_commission` لحد 57-5
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
      <TipsBlock tips={tips.data} />
      <WorkLines query={lines} {...(context.timezone ? { timezone: context.timezone } : {})} />
    </div>
  );
}
