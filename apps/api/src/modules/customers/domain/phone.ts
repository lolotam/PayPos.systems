import { InvalidCustomerPhoneError } from './errors.ts';

/**
 * يكوّن E.164 من البلد المختار ويحذف فواصل وأصفار البداية؛ الكويت تحتاج ثمانية أرقام وطنية بقرار المالك 2026-10-03.
 *
 * @param phone كود الاتصال المختار والرقم الوطني المدخل
 * @param phone.calling_code كود الاتصال الدولي دون علامة الجمع
 * @param phone.national_number الرقم الوطني قبل التطبيع
 * @returns الهاتف المطبع بصيغة E.164
 */
export function normalizePhone(phone: { calling_code: string; national_number: string }): string {
  if (!/^[1-9][0-9]{0,2}(?![\s\S])/.test(phone.calling_code)) throw new InvalidCustomerPhoneError();
  if (!/^[0-9 ().-]+(?![\s\S])/.test(phone.national_number)) throw new InvalidCustomerPhoneError();
  const national = phone.national_number.replace(/[ ().-]/g, '').replace(/^0+/, '');
  const normalized = `+${phone.calling_code}${national}`;
  if (
    national.length === 0 ||
    (phone.calling_code === '965' && national.length !== 8) ||
    !/^\+[1-9][0-9]{1,14}(?![\s\S])/.test(normalized)
  )
    throw new InvalidCustomerPhoneError();
  return normalized;
}

/**
 * يخفي كل الهاتف عدا آخر ثلاثة أرقام، لأن الرقم الكامل مسموح فقط في نموذج الإدخال (R1).
 *
 * @param phone هاتف صالح بصيغة E.164
 * @returns بادئة ثابتة مع آخر ثلاثة أرقام، أو الرقمين للحد الأدنى لصيغة E.164
 */
export function maskPhone(phone: string): string {
  return `***${phone.slice(1).slice(-3)}`;
}
