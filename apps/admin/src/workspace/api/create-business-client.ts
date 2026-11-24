'use client';

import {
  business,
  setBusinessCountryResult,
  type Business,
  type Country,
  type CreateBusinessRequest,
  type SetBusinessCountryResult,
} from '@pospay/contracts';

import { apiClient } from '@/shared/api/client';

export const businessesPath = '/v1/businesses';

/**
 * الجسم اللي بيتبعث فعلًا: العملة والتوقيت مش بيتسألوا في الشاشة — defaults العقد بتنطبق على
 * السيرفر، وإرسالهم من العميل كان هيكرّب القيم اللي الشاشة ما سألتش عنها.
 */
export type CreateBusinessWire = Pick<
  CreateBusinessRequest,
  'vertical_type' | 'name_en' | 'name_ar'
>;

/**
 * المسارات مش متسجّلة لسه في paths سكيما OpenAPI بتاعة contracts (فجوة تسجيل tenancy)، فالنوع
 * المولَّد مش بيقبلها. الـ cast ده محصور هنا لحد ما contracts يسجّل المسارات؛ الـ client نفسه
 * بيفضل هو المولَّد بنفس الأصل والـ credentials ونفس الـ middleware.
 */
type BusinessPost = (
  path: string,
  init: { params: { header: Record<string, string> }; body: CreateBusinessWire },
) => Promise<{ data?: unknown; error?: unknown; response: Response }>;

type CountryPut = (
  path: string,
  init: { body: { country: Country } },
) => Promise<{ data?: unknown; error?: unknown; response: Response }>;

/** بينشئ النشاط بمفتاح Idempotency ويحلل الرد بسكيما العقد؛ الرفض بيتبعت بحالته زي بقية عملاء admin. */
export async function createBusiness(
  idempotencyKey: string,
  body: CreateBusinessWire,
): Promise<Business> {
  const post = apiClient().POST as unknown as BusinessPost;
  const result = await post(businessesPath, {
    params: { header: { 'Idempotency-Key': idempotencyKey } },
    body,
  });
  if (!result.response.ok) throw { ...(result.error as object), status: result.response.status };
  return business.parse(result.data);
}

/**
 * بيحدد دولة النشاط الموجود: الإنشاء بيمنع مفتاح country (فجوة الصلاحيات OQ-2/B-5)، فالدولة
 * ليها مسار PUT مصرّح ليه بصراحة منفصل عن صلاحية الإنشاء، ومن غير مفتاح Idempotency.
 */
export async function setBusinessCountry(
  businessId: string,
  country: Country,
): Promise<SetBusinessCountryResult> {
  const put = apiClient().PUT as unknown as CountryPut;
  const result = await put(`/v1/businesses/${businessId}/country`, { body: { country } });
  if (!result.response.ok) throw { ...(result.error as object), status: result.response.status };
  return setBusinessCountryResult.parse(result.data);
}
