import { moneyToString, sumMoney, type Money } from './money.js';

/** سطر بقشيش بطريقة دفع واحدة؛ المبلغ بالفلوس بعد التقريب. */
export interface TipMethodAmount {
  method: 'CASH' | 'CARD';
  amount: Money;
}

/**
 * بيجمع بقشيش النقد وبقشيش البطاقة من سطور مجموعة واحدة.
 * رد الحفظ وقراءة المجموعة الحالية بيستعملوا نفس الجمع، عشان الإجمالي ما يتحسبش مرة تانية في SQL.
 *
 * @param entries سطور البقشيش بالمبلغ بالفلوس وطريقة الدفع
 * @returns إجمالي النقد وإجمالي البطاقة كنص بثلاث خانات، وصفر لو الطريقة مش موجودة
 */
export function sumTipTotalsByMethod(
  entries: readonly TipMethodAmount[],
): { total_cash: string; total_card: string } {
  const amounts = (method: TipMethodAmount['method']) =>
    entries.filter((entry) => entry.method === method).map((entry) => entry.amount);
  return {
    total_cash: moneyToString(sumMoney(amounts('CASH'))),
    total_card: moneyToString(sumMoney(amounts('CARD'))),
  };
}
