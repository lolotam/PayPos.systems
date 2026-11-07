import { assertMoney, MILLS_PER_KWD } from './money.js';
import type { TipMethodAmount } from './tip-totals.js';

/**
 * يجمع بقشيش الشهر بالفلوس دون فرض حد عمود الزيارة على الإجمالي غير المخزّن.
 *
 * @param entries مبالغ الزيارات؛ كل مبلغ غير سالب وداخل حدود Money الحالية
 * @returns إجماليا النقد والبطاقة كنصين قانونيين بثلاث خانات دون سقف شهري مصطنع
 */
export function sumMonthlyTipTotalsByMethod(entries: readonly TipMethodAmount[]): {
  total_cash: string;
  total_card: string;
} {
  const totals = { CASH: 0n, CARD: 0n };
  for (const entry of entries) {
    const amount = assertMoney(entry.amount);
    if (amount < 0n) throw new RangeError('Monthly tip entry must be nonnegative');
    totals[entry.method] += amount;
  }
  return { total_cash: monthlyTotalText(totals.CASH), total_card: monthlyTotalText(totals.CARD) };
}

function monthlyTotalText(mills: bigint): string {
  return `${mills / MILLS_PER_KWD}.${(mills % MILLS_PER_KWD).toString().padStart(3, '0')}`;
}
