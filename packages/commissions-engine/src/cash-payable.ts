import { assertMoney, type Money } from '@pospay/domain';

/** أصغر عملة كاش في الكويت: 5 فلوس = 0.005 د.ك (CS-Q12). */
const CASH_STEP_MILLS = 5n;

/**
 * يقرّب صافي الصرف لأقرب 5 فلوس لما الصرف كاش (CS-Q12، D-19): المبلغ الدقيق بيفضل زي ما هو في الكشف المجمّد،
 * والمتقرّب هو اللي بيتخزّن جنبه في سجل الصرف ويتصرف فعلاً. التعادل بيتقرّب لفوق (نصف لفوق).
 * المبلغ بالفلوس عدد صحيح، فباقي القسمة على 5 بيبقى 0 أو 1 أو 2 أو 3 أو 4: 1 و2 بينزلوا و3 و4 بيطلعوا،
 * ومفيش فلس صحيح بيقع على نص المسافة بالظبط (النص 2.5 فلس)، فقاعدة التعادل مكتوبة في الحساب ومش بتغيّر ناتج
 * أي مدخل صحيح. الدالة بتتطبق على صافي كل موظفة لوحده ومش على مجموع النشاط (D-19).
 *
 * @param payableMills صافي الصرف الدقيق للموظفة بالفلوس، غير سالب
 * @returns الصافي متقرّب لأقرب مضاعف لـ 5 فلوس
 */
export function roundCashPayable(payableMills: Money): Money {
  const exact = assertMoney(payableMills);
  if (exact < 0n) throw new RangeError(`A payable amount is never negative, got ${exact}`);
  return assertMoney(((exact * 2n + CASH_STEP_MILLS) / (CASH_STEP_MILLS * 2n)) * CASH_STEP_MILLS);
}
