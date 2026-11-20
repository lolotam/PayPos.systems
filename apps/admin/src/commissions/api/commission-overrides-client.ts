import {
  commissionOverrideServiceList,
  commissionServiceOverride,
  commissionServiceOverrideList,
  type CommissionOverrideServiceList,
  type CommissionServiceOverride,
  type CommissionServiceOverrideList,
  type CreateCommissionServiceOverrideInput,
} from '@pospay/contracts';
import { apiClient } from '@/shared/api/client';
// قاعدة الرفض واحدة لكل عملاء العمولة: الحالة بتتفحص قبل الجسم عشان 403 بجسم فاضي ما يضيعش.
import { refusal } from './commission-plans-client';
import type { PlanScope } from './plan-access';

const employeePath = '/v1/businesses/{businessId}/employees/{employeeId}';
const overrideServicesPath = `${employeePath}/commission-override-services`;
const overridesPath = `${employeePath}/commission-overrides`;

/** صفحة الطلب: المؤشر وإشارة الإلغاء اللي جايين من TanStack. */
export type OverridePage = { cursor: string | undefined; signal: AbortSignal };

/** بيجيب صفحة خدمات النشاط مع التجاوز الحالي لكل خدمة (حتى 50)، وبيحللها بسكيما العقد. */
export async function fetchOverrideServices(
  scope: PlanScope,
  employeeId: string,
  page: OverridePage,
): Promise<CommissionOverrideServiceList> {
  const result = await apiClient().GET(overrideServicesPath, {
    params: {
      header: { 'x-company-id': scope[1] },
      path: { businessId: scope[2], employeeId },
      query: { limit: 50, ...(page.cursor === undefined ? {} : { cursor: page.cursor }) },
    },
    signal: page.signal,
  });
  if (!result.response.ok) throw refusal(result.error ?? {}, result.response.status);
  return commissionOverrideServiceList.parse(result.data);
}

/** بيجيب تاريخ تجاوزات خدمة واحدة (حتى 20 سطر) من الأحدث للأقدم، وبيحللها بسكيما العقد. */
export async function fetchOverrideHistory(
  scope: PlanScope,
  employeeId: string,
  serviceId: string,
  page: OverridePage,
): Promise<CommissionServiceOverrideList> {
  const result = await apiClient().GET(overridesPath, {
    params: {
      header: { 'x-company-id': scope[1] },
      path: { businessId: scope[2], employeeId },
      query: {
        service_id: serviceId,
        limit: 20,
        ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
      },
    },
    signal: page.signal,
  });
  if (!result.response.ok) throw refusal(result.error ?? {}, result.response.status);
  return commissionServiceOverrideList.parse(result.data);
}

/** بيحفظ تجاوز جديد بمفتاح Idempotency ويرجّع السطر المخزّنة بعد تحليله بسكيما العقد. */
export async function createServiceOverride(
  scope: PlanScope,
  employeeId: string,
  idempotencyKey: string,
  body: CreateCommissionServiceOverrideInput,
): Promise<CommissionServiceOverride> {
  const result = await apiClient().POST(overridesPath, {
    params: {
      header: { 'x-company-id': scope[1], 'Idempotency-Key': idempotencyKey },
      path: { businessId: scope[2], employeeId },
    },
    body,
  });
  if (!result.response.ok) throw refusal(result.error ?? {}, result.response.status);
  return commissionServiceOverride.parse(result.data);
}
