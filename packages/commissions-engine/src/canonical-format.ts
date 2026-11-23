import { moneyToString } from '@pospay/domain';

import type { CommissionCalc, ServiceCommissionRule } from './commission-types.ts';

/**
 * يرتّب نسخة من القائمة بمفتاح نصي مركّب؛ المقارنة بالنص الحرفي (code units) عشان الترتيب
 * يبقى نفس الترتيب على أي جهاز ولا يتأثر بلغة النظام.
 *
 * @param items القائمة اللي هتترتب
 * @param key أجزاء المفتاح بترتيب الأولوية
 * @returns نسخة مرتبة، والقائمة الأصلية ما بتتغيّرش
 */
export function sortedBy<T>(items: readonly T[], key: (item: T) => readonly string[]): T[] {
  return [...items].sort((left, right) => {
    const a = key(left);
    const b = key(right);
    for (let index = 0; index < a.length; index += 1) {
      const x = a[index] ?? '';
      const y = b[index] ?? '';
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  });
}

/**
 * يجمّع قائمة بمفتاح نصي مرة واحدة؛ العنصر اللي مفتاحه null بيتسيب (بيع باقة بلا بائعة مثلًا).
 *
 * @param items عناصر القائمة
 * @param keyOf المفتاح المرتبط بالعنصر أو null
 * @returns عناصر كل مفتاح بترتيبها الأصلي
 */
export function groupByKey<T>(
  items: readonly T[],
  keyOf: (item: T) => string | null,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === null) continue;
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, [item]);
    else bucket.push(item);
  }
  return grouped;
}

/**
 * يحوّل وقت UTC بالـ microseconds لنص ISO بست منازل كسرية. الحساب بأعداد صحيحة بالكامل،
 * لأن `Date` بيقصّ الـ microseconds، ونسختان من بند بينهم microsecond واحدة لازم يطلعوا مختلفين.
 *
 * @param micros الوقت بالـ microseconds من بداية 1970 UTC
 * @returns نص مثل `2026-11-05T10:20:30.123456Z`
 */
export function microsToIso(micros: bigint): string {
  let millis = micros / 1000n;
  let rest = micros % 1000n;
  if (rest < 0n) {
    rest += 1000n;
    millis -= 1n;
  }
  const iso = new Date(Number(millis)).toISOString();
  return `${iso.slice(0, -1)}${rest.toString().padStart(3, '0')}Z`;
}

/**
 * يكتب حساب نسبة أو مبلغ ثابت: النسبة بوحدات bps كعدد صحيح نصي، والمبلغ الثابت كنص KWD.
 *
 * @param calc حساب النسبة أو المبلغ الثابت
 * @returns شكل JSON آمن لـ canonicalJson
 */
export function calcJson(calc: CommissionCalc): { kind: string; value: string } {
  return {
    kind: calc.kind,
    value: calc.kind === 'FIXED' ? moneyToString(calc.value) : calc.value.toString(),
  };
}

/**
 * يكتب قاعدة الخدمة (لقطة البند أو التجاوز) بشكل JSON آمن؛ ZERO وFOLLOW_PLAN بلا قيمة.
 *
 * @param rule قاعدة الخدمة
 * @returns شكل JSON آمن لـ canonicalJson
 */
export function ruleJson(rule: ServiceCommissionRule): { kind: string; value?: string } {
  return rule.kind === 'PCT' || rule.kind === 'FIXED' ? calcJson(rule) : { kind: rule.kind };
}
