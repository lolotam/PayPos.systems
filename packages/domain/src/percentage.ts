import { assertMoney, type Money } from './money.js';
import { roundKwd } from './rounding.js';

/**
 * نسبة مئوية متخزنة كـ bigint بوحدة 0.0001% (4 خانات عشرية، ADR-0005).
 * يعني 5% = 50000n، و 12.5% = 125000n، و 100% = 1000000n.
 * النسبة دايماً موجبة أو صفر — السالب بييجي من المبلغ نفسه (مرتجع)، مش من النسبة.
 */
export type Percentage = bigint;

/**
 * قيمة 100% بوحدة Percentage — المقام اللي بنقسم عليه لما نطبّق نسبة على مبلغ.
 */
export const PERCENTAGE_SCALE = 1_000_000n;

const UNITS_PER_PERCENT = 10_000n;
const PERCENTAGE_TEXT = /^(\d+)(?:\.(\d{1,4}))?$/;

/**
 * بيتأكد إن القيمة نسبة صالحة: bigint وموجبة أو صفر.
 * مفيش حد أعلى لأن نسبة زي هامش الربح ممكن تعدّي 100%.
 *
 * @param value النسبة بوحدة 0.0001%
 * @returns نفس القيمة كـ Percentage لو صالحة
 */
export function assertPercentage(value: bigint): Percentage {
  if (typeof value !== 'bigint') {
    throw new TypeError(`Percentage must be a bigint, got ${typeof value}`);
  }
  if (value < 0n) {
    throw new RangeError(`Percentage must not be negative, got ${value}`);
  }
  return value;
}

/**
 * بيحوّل نص زي "5" أو "12.5" أو "0.1250" (بالمية) لـ Percentage.
 * أكتر من 4 خانات عشرية بيترفض ومش بيتقرّب، عشان نسبة الضريبة أو العمولة
 * متتغيرش في السر وقت الإدخال.
 *
 * @param text النسبة بالمية كنص عشري، من غير علامة %
 * @returns النسبة بوحدة 0.0001%
 */
export function parsePercentage(text: string): Percentage {
  const match = PERCENTAGE_TEXT.exec(text);
  if (match === null) {
    throw new TypeError(`Invalid percentage string: "${text}"`);
  }
  const [, whole = '0', fraction = ''] = match;
  return BigInt(whole) * UNITS_PER_PERCENT + BigInt(fraction.padEnd(4, '0'));
}

/**
 * بيحوّل Percentage لنص بـ 4 خانات عشرية (125000n ← "12.5000").
 * ده شكل النقل في JSON، ولو اتقرا تاني بـ parsePercentage بيرجع لنفس القيمة بالظبط.
 *
 * @param value النسبة بوحدة 0.0001%
 * @returns النسبة بالمية كنص بـ 4 خانات عشرية
 */
export function percentageToString(value: Percentage): string {
  assertPercentage(value);
  const fraction = (value % UNITS_PER_PERCENT).toString().padStart(4, '0');
  return `${value / UNITS_PER_PERCENT}.${fraction}`;
}

/**
 * بيحسب نسبة من مبلغ (عمولة، خصم، ضريبة) ويقرّب الناتج لأقرب فلس بـ roundKwd.
 * الضرب بيحصل الأول والقسمة مرة واحدة في الآخر، فمفيش تقريب وسيط بيضيّع فلوس.
 * مبلغ سالب بيطلّع نتيجة سالبة بنفس القيمة المطلقة بالظبط.
 *
 * @param amount المبلغ بالفلوس — سالب في حالة المرتجع
 * @param rate   النسبة بوحدة 0.0001%
 * @returns قيمة النسبة من المبلغ بالفلوس، متقرّبة half-up
 */
export function applyPercentage(amount: Money, rate: Percentage): Money {
  return roundKwd(assertMoney(amount) * assertPercentage(rate), PERCENTAGE_SCALE);
}
