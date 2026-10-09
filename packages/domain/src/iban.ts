/** دول الخليج المقبولة فقط بحسب قرار المالك؛ أطوالها وأشكالها من سجل الآيبان. */
export const GCC_IBAN_COUNTRIES = ['KW', 'SA', 'AE', 'BH', 'QA', 'OM'] as const;
/** رمز دولة مسموحة لحساب الموظف. */
export type GccIbanCountry = (typeof GCC_IBAN_COUNTRIES)[number];
const SHAPES: Record<GccIbanCountry, RegExp> = {
  KW: /^KW[0-9]{2}[A-Z]{4}[A-Z0-9]{22}$/,
  SA: /^SA[0-9]{4}[A-Z0-9]{18}$/,
  AE: /^AE[0-9]{21}$/,
  BH: /^BH[0-9]{2}[A-Z]{4}[A-Z0-9]{14}$/,
  QA: /^QA[0-9]{2}[A-Z]{4}[A-Z0-9]{21}$/,
  OM: /^OM[0-9]{5}[A-Z0-9]{16}$/,
};
/** نتيجة التحقق دون تضمين القيمة الحساسة عند الرفض. */
export type IbanValidation =
  | { ok: true; iban: string; country: GccIbanCountry; bankCode: string }
  | { ok: false; reason: 'FORMAT' | 'COUNTRY' | 'CHECKSUM' };

/**
 * يوحد الأرقام العربية والفارسية والحروف اللاتينية ويزيل المسافة العادية فقط؛ التبويب ليس فاصلاً مقبولاً.
 *
 * @param value الآيبان المدخل
 * @returns القيمة الموحدة دون إخفاء المحارف غير المسموحة
 */
export function normalizeIban(value: string): string {
  return value
    .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (c) =>
      String(c.charCodeAt(0) - (c.charCodeAt(0) <= 0x669 ? 0x660 : 0x6f0)),
    )
    .replace(/ /g, '')
    .replace(/[a-z]/g, (c) => c.toUpperCase());
}

/**
 * يوحد مسافات اسم صاحب الحساب ويقبل الاسم الإنجليزي فقط حتى يطابق صيغة ملف البنك.
 * يبدأ الاسم بحرف لاتيني ويكون طوله بعد التوحيد من حرف واحد إلى مئة حرف.
 *
 * @param value اسم صاحب الحساب المدخل
 * @returns الاسم الموحد أو لا شيء عند مخالفة قاعدة الاسم
 */
export function normalizeHolderName(value: string): string | null {
  const name = value.trim().replace(/\s+/g, ' ');
  return name.length <= 100 && /^[A-Za-z][A-Za-z .'-]*$/.test(name) ? name : null;
}

/**
 * يحسب باقي القسمة رقماً رقماً لتجنب فقد الدقة عند تحويل حساب طويل إلى عدد.
 *
 * @param iban الآيبان الموحد
 * @returns صحة فحص MOD 97-10
 */
export function ibanChecksumValid(iban: string): boolean {
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) return false;
  let remainder = 0;
  for (const char of iban.slice(4) + iban.slice(0, 4)) {
    const digits = char >= 'A' && char <= 'Z' ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/**
 * يستخرج رمز البنك حسب طول جزء البنك في سجل دولة الحساب، دون تخمين اسم البنك.
 *
 * @param iban الآيبان الموحد
 * @returns رمز البنك أو نص فارغ لدولة غير مدعومة
 */
export function ibanBankCode(iban: string): string {
  const country = iban.slice(0, 2);
  if (['KW', 'BH', 'QA'].includes(country)) return iban.slice(4, 8);
  if (country === 'SA') return iban.slice(4, 6);
  if (country === 'AE' || country === 'OM') return iban.slice(4, 7);
  return '';
}

/**
 * يتحقق من الدولة والشكل قبل فحص الرقم؛ الحسابات خارج الخليج مرفوضة بقرار المالك.
 *
 * @param value الآيبان كما أدخله المستخدم
 * @returns حساب موحد صالح أو سبب رفض لا يكشف الحساب
 */
export function validateIban(value: string): IbanValidation {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) return { ok: false, reason: 'FORMAT' };
  const country = iban.slice(0, 2) as GccIbanCountry;
  if (!GCC_IBAN_COUNTRIES.includes(country)) return { ok: false, reason: 'COUNTRY' };
  if (!SHAPES[country].test(iban)) return { ok: false, reason: 'FORMAT' };
  if (!ibanChecksumValid(iban)) return { ok: false, reason: 'CHECKSUM' };
  return { ok: true, iban, country, bankCode: ibanBankCode(iban) };
}

/**
 * يحتفظ بآخر أربعة محارف فقط للتدقيق والعرض المحدود.
 *
 * @param iban الآيبان الموحد
 * @returns آخر أربعة محارف
 */
export function maskIban(iban: string): string {
  return iban.slice(-4);
}

/**
 * يقسم الآيبان لمجموعات من أربعة لتسهيل المراجعة البصرية دون تغيير قيمته.
 *
 * @param iban الآيبان المدخل أو الموحد
 * @returns نص العرض ذي المسافات
 */
export function formatIbanForDisplay(iban: string): string {
  return (
    normalizeIban(iban)
      .match(/.{1,4}/g)
      ?.join(' ') ?? ''
  );
}
