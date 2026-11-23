import { id } from '@pospay/contracts';
import { updateRequestContext } from '@pospay/observability';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../../../shared/errors.ts';

/**
 * المستخدم والشركة المختارة لطلب قراءة التقييمات، بنفس شروط SelectedCompanyGuard بس من غير ما تفتح معاملة: الجلسة مستخدم
 * حقيقي، والهيدر `x-company-id` معرّف صالح. العضوية والشركة المفتوحة بيتثبتوا بعد كده جوه معاملة القراءة نفسها.
 *
 * @param request الطلب بعد مصادقة الجلسة
 * @returns المستخدم من الجلسة والشركة من الهيدر (لسه مش متثبتة العضوية)
 */
export function selectedCompanyOf(request: FastifyRequest): { userId: string; companyId: string } {
  const principal = request.principal;
  if (principal?.kind !== 'user' || principal.userId === null) throw new ApiError('FORBIDDEN');
  const parsed = id.safeParse(request.headers['x-company-id']);
  if (!parsed.success) throw new ApiError('BAD_REQUEST');
  const companyId = parsed.data.toLowerCase();
  updateRequestContext({ companyId });
  return { userId: principal.userId, companyId };
}
