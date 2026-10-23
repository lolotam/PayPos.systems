import { personalWorkspace, type PersonalOtpRequestInput } from '@pospay/contracts';

import { nativePosHost } from '@/shared/platform/native-shell';

/** الشركة والنشاط اللي الموظفة بتتصل بيهم — تلميح توجيه مش صلاحية (BR-002). */
export type PersonalWorkspace = Pick<PersonalOtpRequestInput, 'company_id' | 'business_id'>;

/**
 * بيقرأ لينك المدير ويطلّع منه الشركة والنشاط.
 *
 * الـ host بيتقارن بالظبط من غير استثناء: أي مضيف شبيه (نطاق فرعي أو بورت) يقدر يزرع
 * نشاط تاني في جهاز الموظفة، فمفيش subdomain ولا port مقبول. المسار كمان لازم يكون
 * `/personal` بالظبط، وأي معامل تاني في اللينك بيتجاهل.
 *
 * @param raw اللينك زي ما وصل (من لصق أو من فتح)
 * @param posHost الـ host بتاع نسخة التطبيق
 * @returns الشركة والنشاط، أو null لو اللينك مش مقبول
 */
export function parseManagerLink(raw: string, posHost: string): PersonalWorkspace | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.host !== posHost) return null;
  if (url.pathname !== '/personal') return null;
  const parsed = personalWorkspace.safeParse({
    company_id: url.searchParams.get('company'),
    business_id: url.searchParams.get('business'),
  });
  return parsed.success ? parsed.data : null;
}

/**
 * بيقرأ لينك المدير بالـ host المضمون في البناء.
 *
 * @param raw اللينك زي ما وصل
 * @returns الشركة والنشاط، أو null لو اللينك مش مقبول
 */
export function readManagerLink(raw: string): PersonalWorkspace | null {
  try {
    return parseManagerLink(raw, nativePosHost());
  } catch {
    // بناء من غير host معرّف ما بيقبلش أي لينك، فالمستخدم يطلب من المدير لينك تاني.
    return null;
  }
}
