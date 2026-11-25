import { z } from 'zod';

import { ownWorkMonth } from '../orders/own-work-month.js';
import { id } from '../scalars/id.js';
import { commissionEstimateMoney, commissionEstimatePeriod } from './estimate.js';
import { commissionStatementTotalMoney } from './statement.js';

/**
 * استعلام تقدير عمولتي: الشهر اختياري، وغيابه يعني الشهر الحالي في توقيت النشاط.
 * الاستعلام صارم: أي مفتاح آخر (ومنهم مفاتيح الموضوع) يرفض الطلب قبل أي قراءة.
 */
export const ownCommissionEstimateQuery = z.strictObject({ month: ownWorkMonth.optional() });

/** بند من بنود الموظفة النشطة بمبلغه المسعّر في الشهر (MY-05). */
export const ownCommissionEstimateLine = z.strictObject({
  line_id: id,
  amount: commissionEstimateMoney,
});

/**
 * نوع التصحيح كما يراه المدير: LINE مصدره بند زيارة، والباقي بيع أو بقشيش.
 * تفاصيل الخدمة على LINE وحدها (spec 059 FR-033 يجمّد البيع والبقشيش بلا تفاصيل بند).
 */
export const ownCommissionCorrectionKind = z.enum(['LINE', 'SALE', 'TIP_CARD', 'TIP_CASH']);

/**
 * تفاصيل التصحيح كما يراها المدير: اليوم والخدمة وشهر المصدر وقبل وبعد والفرق.
 * لا اسم عميل ولا هاتفه أبداً (CS-Q30).
 */
export const ownCommissionCorrection = z
  .strictObject({
    kind: ownCommissionCorrectionKind,
    source_period: commissionEstimatePeriod,
    business_date: z.iso.date().nullable(),
    service_name_ar: z.string().nullable(),
    service_name_en: z.string().nullable(),
    previous_amount: commissionEstimateMoney,
    new_amount: commissionEstimateMoney,
    amount: commissionEstimateMoney,
  })
  .superRefine((correction, ctx) => {
    if (
      correction.kind !== 'LINE' &&
      (correction.service_name_ar !== null || correction.service_name_en !== null)
    ) {
      ctx.addIssue({ code: 'custom', message: 'OWN_COMMISSION_CORRECTION_SERVICE_IS_LINE_ONLY' });
    }
  });

/**
 * تقدير عمولتي لشهر واحد (FR-A02): HIDDEN بلا أي مبلغ، وESTIMATE بالمجموع وبنوده،
 * وNO_PLAN وNO_SALARY بلا مبلغ ولا بنود مع بقاء التصحيحات، وAPPROVED بمبلغ الكشف المعتمد.
 */
export const ownCommissionEstimate = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('HIDDEN') }),
  z.strictObject({
    status: z.literal('ESTIMATE'),
    total: commissionStatementTotalMoney,
    per_line: z.array(ownCommissionEstimateLine),
    corrections: z.array(ownCommissionCorrection),
    recalculated: z.boolean(),
  }),
  z.strictObject({ status: z.literal('NO_PLAN'), corrections: z.array(ownCommissionCorrection) }),
  z.strictObject({ status: z.literal('NO_SALARY'), corrections: z.array(ownCommissionCorrection) }),
  z.strictObject({
    status: z.literal('APPROVED'),
    total: commissionStatementTotalMoney,
    corrections: z.array(ownCommissionCorrection),
  }),
]);

export type OwnCommissionEstimateLine = z.infer<typeof ownCommissionEstimateLine>;
export type OwnCommissionCorrection = z.infer<typeof ownCommissionCorrection>;
export type OwnCommissionEstimate = z.infer<typeof ownCommissionEstimate>;
