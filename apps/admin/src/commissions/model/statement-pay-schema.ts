import { markCommissionStatementPaidInput } from '@pospay/contracts';
import { dayBefore, approvalDay } from './statement-period';

/**
 * سكيما فورم الصرف: عقد الطلب نفسه، ومعاه رفض تاريخ قبل يوم الاعتماد. يوم الاعتماد هنا تاريخ UTC للحظة الاعتماد
 * ومطروح منه يوم، لأن مفيش مصدر لتقويم النشاط في الأدمن؛ فالفحص بيرفض بس اللي قبل الاعتماد بالتأكيد ومش بيرفض
 * يوم صالح بتوقيت النشاط. «النهارده والمستقبل» ما بيتفحصوش هنا أبدًا: السيرفر هو اللي بيفصل فيهم.
 *
 * @param approvedAt لحظة اعتماد الكشف، أو undefined لو الشاشة ما معهاش
 * @returns سكيما الفورم
 */
export function payFormSchema(approvedAt: string | undefined) {
  const floor = approvedAt === undefined ? null : dayBefore(approvalDay(approvedAt));
  return markCommissionStatementPaidInput.superRefine((value, context) => {
    if (floor !== null && value.paid_on < floor) {
      context.addIssue({ code: 'custom', path: ['paid_on'], message: 'before-approval-day' });
    }
  });
}
