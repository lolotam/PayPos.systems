/**
 * مبلغ بالدينار الكويتي متخزن كـ bigint بالفلوس (1 KWD = 1000 فلس).
 * مفيش number خالص، عشان الـ float بيضيّع فلوس في الجمع والضرب.
 * القيمة ممكن تبقى سالبة — المرتجعات وعكس العمولة بيتسجلوا بالسالب.
 */
export type Money = bigint;

/**
 * عدد الفلوس في الدينار الواحد — الدينار الكويتي 3 خانات عشرية.
 */
export const MILLS_PER_KWD = 1000n;

/**
 * أكبر مبلغ ينفع يتخزن في عمود Postgres من نوع numeric(14,3)
 * (11 خانة صحيحة + 3 عشرية). أي قيمة أكبر منه الداتابيز هترفضها،
 * فبنرفضها إحنا الأول وبرسالة واضحة.
 */
export const MONEY_MAX: Money = 99_999_999_999_999n;

/**
 * أصغر مبلغ سالب مسموح — نفس حد MONEY_MAX بالسالب.
 */
export const MONEY_MIN: Money = -MONEY_MAX;

const MONEY_TEXT = /^(-?)(\d+)(?:\.(\d{1,3}))?$/;

/**
 * بيتأكد إن القيمة مبلغ صالح: bigint، وجوه حدود numeric(14,3).
 * الفحص على النوع وقت التشغيل مقصود — قيمة جاية من JSON ممكن توصل number
 * والـ type checker مش هيشوفها.
 *
 * @param value القيمة بالفلوس
 * @returns نفس القيمة كـ Money لو صالحة
 */
export function assertMoney(value: bigint): Money {
  if (typeof value !== 'bigint') {
    throw new TypeError(`Money must be a bigint of mills, got ${typeof value}`);
  }
  if (value > MONEY_MAX || value < MONEY_MIN) {
    throw new RangeError(`Money ${value} mills is outside numeric(14,3)`);
  }
  return value;
}

/**
 * بيحوّل نص عشري بالدينار (زي "12.5" أو "-0.125" أو قيمة numeric راجعة من Postgres) لـ Money.
 * أكتر من 3 خانات عشرية بيترفض ومش بيتقرّب — التقريب قرار حسابي
 * مكانه roundKwd، مش خطوة قراءة البيانات.
 *
 * @param text المبلغ بالدينار كنص عشري، من غير مسافات أو أُس
 * @returns المبلغ بالفلوس
 */
export function parseMoney(text: string): Money {
  const match = MONEY_TEXT.exec(text);
  if (match === null) {
    throw new TypeError(`Invalid money string: "${text}"`);
  }
  const [, sign, whole = '0', fraction = ''] = match;
  const mills = BigInt(whole) * MILLS_PER_KWD + BigInt(fraction.padEnd(3, '0'));
  return assertMoney(sign === '-' ? -mills : mills);
}

/**
 * بيحوّل Money لنص عشري بـ 3 خانات دايماً (12500n ← "12.500").
 * ده شكل النقل في JSON وفي الداتابيز، لأن JSON.stringify بيرفض bigint،
 * ورقم عشري زي 12.5 في JSON بيتقري float — النص بيرجع لنفس القيمة بالظبط.
 *
 * @param value المبلغ بالفلوس
 * @returns المبلغ بالدينار كنص بـ 3 خانات عشرية
 */
export function moneyToString(value: Money): string {
  assertMoney(value);
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  const fraction = (abs % MILLS_PER_KWD).toString().padStart(3, '0');
  return `${sign}${abs / MILLS_PER_KWD}.${fraction}`;
}

/**
 * بيجمع مبالغ متقرّبة خلاص — الإجمالي بيتجمع من البنود بعد تقريبها،
 * ومش بيتحسب تاني من الأرقام الخام، عشان الإجمالي يطابق مجموع اللي مطبوع على الفاتورة.
 *
 * @param values المبالغ بالفلوس، كل واحد متقرّب على مستوى البند
 * @returns المجموع بالفلوس — صفر لو القائمة فاضية
 */
export function sumMoney(values: readonly Money[]): Money {
  let total = 0n;
  for (const value of values) {
    total += assertMoney(value);
  }
  return assertMoney(total);
}
