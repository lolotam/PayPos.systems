import { z } from 'zod';

/** الاستعلام صارم وفاضي: أي مفتاح (ومنهم مفاتيح الموضوع) بيرفض الطلب قبل أي قراءة. */
export const ownRatingSummaryQuery = z.strictObject({});

const ownRatingSummaryVisible = z.strictObject({
  visibility: z.literal('VISIBLE'),
  average: z
    .string()
    .regex(/^(?:[1-4]\.[0-9]|5\.0)$/)
    .nullable(),
  count: z.number().int().nonnegative(),
});

/**
 * متوسط تقييم الموظفة لنفسها: إما HIDDEN أو VISIBLE.
 * القاعدة: `count = 0` ⇔ `average = null` (PP-18.15 — تتعرض من أول تقييم)،
 * ولا يظهر أي حقل آخر — لا تعليق ولا عميل ولا قائمة نجوم ولا رقم موظفة أخرى (S-9، S-11).
 */
export const ownRatingSummary = z
  .discriminatedUnion('visibility', [
    z.strictObject({ visibility: z.literal('HIDDEN') }),
    ownRatingSummaryVisible,
  ])
  .superRefine((summary, ctx) => {
    if (summary.visibility !== 'VISIBLE') return;
    if ((summary.count === 0) !== (summary.average === null)) {
      ctx.addIssue({ code: 'custom', message: 'OWN_RATING_AVERAGE_COUNT_MISMATCH' });
    }
  });
export type OwnRatingSummary = z.infer<typeof ownRatingSummary>;
