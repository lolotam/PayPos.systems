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
 */
export function buildEmployeeAppLink(
  posOrigin: string | undefined,
  companyId: string,
  businessId: string,
): string | null {
  let origin: URL;
  try {
    origin = new URL(posOrigin?.trim() ?? '');
  } catch {
    return null;
  }
  if (
    origin.protocol !== 'https:' ||
    origin.port !== '' ||
    (origin.pathname !== '/' && origin.pathname !== '') ||
    origin.search !== '' ||
    origin.hash !== '' ||
    origin.username !== '' ||
    origin.password !== '' ||
    !Object.values(POS_HOSTS).includes(origin.host as PosHost)
  ) {
    return null;
  }
  const link = new URL('/personal', origin);
  link.searchParams.set('company', companyId);
  link.searchParams.set('business', businessId);
  return link.toString();
}
