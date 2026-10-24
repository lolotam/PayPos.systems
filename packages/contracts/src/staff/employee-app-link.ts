import { z } from 'zod';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';

export const POS_HOSTS = {
  staging: 'pos.staging.pospay.systems',
  production: 'pos.pospay.systems',
} as const;
export type PosHost = (typeof POS_HOSTS)[keyof typeof POS_HOSTS];

export const employeeAppLink = responseObject({
    company_id: id,
    business_id: id,
    business_name_en: z.string(),
    business_name_ar: z.string().nullable(),
  })
  .meta({ id: 'EmployeeAppLink' });
export type EmployeeAppLink = z.infer<typeof employeeAppLink>;

/**
 * التطبيق بيرفض أي host غير اللي في القايمة، فأي إعداد غلط لازم يظهر «مش متظبط» مش لينك بايظ.
 * المقارنة بالقايمة المشتركة بتمنع الإدمن والتطبيق يختلفوا على العنوان المقبول.
 * المطابقة الحرفية بتستغني عن URL غير المتاح في ترجمة contracts، وكمان بترفض الـ host المكتوب بحروف مختلفة.
 */
export function buildEmployeeAppLink(
  posOrigin: string | undefined,
  companyId: string,
  businessId: string,
): string | null {
  const origin = posOrigin?.trim() ?? '';
  const host = Object.values(POS_HOSTS).find(
    (candidate) => origin === `https://${candidate}` || origin === `https://${candidate}/`,
  );
  if (host === undefined) return null;
  return `https://${host}/personal?company=${encodeURIComponent(companyId)}&business=${encodeURIComponent(businessId)}`;
}
