import {
  commissionPlanEmployeeList,
  commissionPlanVersion,
  commissionPlanVersionList,
  type CommissionPlanEmployeeList,
  type CommissionPlanVersion,
  type CommissionPlanVersionList,
  type CreateCommissionPlanVersionInput,
} from '@pospay/contracts';
import { apiClient } from '@/shared/api/client';
import type { components } from '@/shared/api/schema';
import type { PlanScope } from './plan-access';

const employeesPath = '/v1/businesses/{businessId}/commission-plan-employees';
const versionsPath = '/v1/businesses/{businessId}/employees/{employeeId}/commission-plan-versions';

/** جسم الطلب على السلك: نفس قيمة العقد، وسكيما OpenAPI بترسم الاختياري بلا undefined تحت exactOptionalPropertyTypes. */
type PlanVersionWireBody = components['schemas']['CreateCommissionPlanVersionInput'];

/** رفض السيرفر بيتبعت بحالته عشان 403 يتفرق عن أي رفض تاني في طبقة الوصول. */
function refusal(error: unknown, status: number): unknown {
  return { ...(error as object), status };
}

/** بيجيب صفحة موظفي الخطط (حتى 50) وبيحللها بسكيما العقد قبل ما تلمس الشاشة. */
export async function fetchCommissionPlanEmployees(
  scope: PlanScope,
  cursor: string | undefined,
  signal: AbortSignal,
): Promise<CommissionPlanEmployeeList> {
  const result = await apiClient().GET(employeesPath, {
    params: {
      header: { 'x-company-id': scope[1] },
      path: { businessId: scope[2] },
      query: { limit: 50, ...(cursor === undefined ? {} : { cursor }) },
    },
    signal,
  });
  // الفحص على حالة الرد مش على الجسم: الجسم الفاضي بيرجّع error فاضي بيضيع 403 لو اتساب لتحليل السكيما.
  if (!result.response.ok) throw refusal(result.error ?? {}, result.response.status);
  return commissionPlanEmployeeList.parse(result.data);
}

/** بيجيب صفحة نسخ خطة موظفة (حتى 20) من الأحدث للأقدم وبيحللها بسكيما العقد. */
export async function fetchCommissionPlanVersions(
  scope: PlanScope,
  employeeId: string,
  cursor: number | undefined,
  signal: AbortSignal,
): Promise<CommissionPlanVersionList> {
  const result = await apiClient().GET(versionsPath, {
    params: {
      header: { 'x-company-id': scope[1] },
      path: { businessId: scope[2], employeeId },
      query: { limit: 20, ...(cursor === undefined ? {} : { cursor }) },
    },
    signal,
  });
  if (!result.response.ok) throw refusal(result.error ?? {}, result.response.status);
  return commissionPlanVersionList.parse(result.data);
}

/** بيحفظ نسخة جديدة بمفتاح Idempotency ويرجّع النسخة المخزّنة بعد تحليلها بسكيما العقد. */
export async function createCommissionPlanVersion(
  scope: PlanScope,
  employeeId: string,
  idempotencyKey: string,
  body: CreateCommissionPlanVersionInput,
): Promise<CommissionPlanVersion> {
  const result = await apiClient().POST(versionsPath, {
    params: {
      header: { 'x-company-id': scope[1], 'Idempotency-Key': idempotencyKey },
      path: { businessId: scope[2], employeeId },
    },
    body: body as PlanVersionWireBody,
  });
  if (!result.response.ok) throw refusal(result.error ?? {}, result.response.status);
  return commissionPlanVersion.parse(result.data);
}
