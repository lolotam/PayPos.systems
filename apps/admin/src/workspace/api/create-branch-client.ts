'use client';

import { branch, type Branch, type CreateBranchInput } from '@pospay/contracts';

import { apiClient } from '@/shared/api/client';

/** الجسم اللي بيتبعث: الاسمين بس — العنوان والموقع ومواعيد العمل مش من شاشة أول فرع. */
export type CreateBranchWire = Pick<CreateBranchInput, 'name_en' | 'name_ar'>;

/** نفس السبحة بتاعة client الشركة: المسار مش في paths المولَّدة، والـ cast محصور هنا. */
type BranchPost = (
  path: string,
  init: { params: { header: Record<string, string> }; body: CreateBranchWire },
) => Promise<{ data?: unknown; error?: unknown; response: Response }>;

/** بينشئ الفرع بمفتاح Idempotency على مسار النشاط المختار ويحلل الرد بسكيما العقد. */
export async function createBranch(
  companyId: string,
  idempotencyKey: string,
  businessId: string,
  body: CreateBranchWire,
): Promise<Branch> {
  const post = apiClient().POST as unknown as BranchPost;
  // x-company-id صريح من الشركة اللي الشاشة اتفتحت لها، مش الكوكي المشترك وقت الإرسال.
  const result = await post(`/v1/businesses/${businessId}/branches`, {
    params: { header: { 'Idempotency-Key': idempotencyKey, 'x-company-id': companyId } },
    body,
  });
  if (!result.response.ok) throw { ...(result.error as object), status: result.response.status };
  return branch.parse(result.data);
}
