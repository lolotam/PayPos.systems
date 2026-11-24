'use client';

import { company, type Company, type CreateCompanyInput } from '@pospay/contracts';

import { apiClient } from '@/shared/api/client';

export const companiesPath = '/v1/companies';

/**
 * المسار مش متسجّل لسه في paths سكيما OpenAPI بتاعة contracts (فجوة G2)، فالنوع المولَّد لـ POST
 * مش بيقبله. الـ cast ده محصور هنا لحد ما contracts يسجّل المسار؛ الـ client نفسه بيفضل هو المولَّد
 * بنفس الأصل والـ credentials ونفس الـ middleware.
 */
type CompanyPost = (
  path: string,
  init: { params: { header: Record<string, string> }; body: CreateCompanyInput },
) => Promise<{ data?: unknown; error?: unknown; response: Response }>;

/** بيرفض 403 عشان شاشة الإنشاء تعرض الرفض المخصوص بدل التنبيه العام. */
export function isForbidden(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 403
  );
}

/** بيقرا أول issue من رفض السيرفر عشان مشكلة اسم معروف ترجع لحقلها بدل التنبيه العام. */
export function issueField(error: unknown): 'name_en' | 'name_ar' | null {
  if (typeof error !== 'object' || error === null) return null;
  const details = (error as { details?: unknown }).details;
  if (!Array.isArray(details)) return null;
  const first = details[0];
  if (typeof first !== 'object' || first === null) return null;
  const path = (first as { path?: unknown }).path;
  if (Array.isArray(path) && (path[0] === 'name_en' || path[0] === 'name_ar')) return path[0];
  return null;
}

/** بيأنشئ الشركة بمفتاح Idempotency ويحلل الرد بسكيما العقد؛ الرفض بيتبعت بحالته زي بقية عملاء admin. */
export async function createCompany(
  idempotencyKey: string,
  body: CreateCompanyInput,
): Promise<Company> {
  const post = apiClient().POST as unknown as CompanyPost;
  const result = await post(companiesPath, {
    params: { header: { 'Idempotency-Key': idempotencyKey } },
    body,
  });
  if (!result.response.ok) throw { ...(result.error as object), status: result.response.status };
  return company.parse(result.data);
}
