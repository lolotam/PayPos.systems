import {
  commissionBlockedCorrectionList,
  commissionPeriodRepair,
  commissionPlanEmployeeList,
  commissionPlanVersion,
  commissionPlanVersionList,
  type CommissionBlockedCorrectionList,
  type CommissionBlockedCorrectionStatus,
  type CommissionPeriodRepair,
  type CommissionPlanEmployeeList,
  type CommissionPlanVersion,
  type CommissionPlanVersionList,
  type CreateCommissionPeriodRepairInput,
  type CreateCommissionPlanVersionInput,
} from '@pospay/contracts';
import { apiClient } from '@/shared/api/client';
import type { components } from '@/shared/api/schema';
import type { PlanScope } from './plan-access';

const employeesPath = '/v1/businesses/{businessId}/commission-plan-employees';
const versionsPath = '/v1/businesses/{businessId}/employees/{employeeId}/commission-plan-versions';

const blockedCorrectionsPath = '/v1/businesses/{businessId}/commission-blocked-corrections';
const periodRepairsPath =
  '/v1/businesses/{businessId}/employees/{employeeId}/commission-period-repairs';

/** جسم طلب الإصلاح على السلك، بنفس سبب نوع جسم النسخة. */
type PeriodRepairWireBody = components['schemas']['CreateCommissionPeriodRepairInput'];

/** جسم الطلب على السلك: نفس قيمة العقد، وسكيما OpenAPI بترسم الاختياري بلا undefined تحت exactOptionalPropertyTypes. */
type PlanVersionWireBody = components['schemas']['CreateCommissionPlanVersionInput'];

/** رفض السيرفر بيتبعت بحالته عشان 403 يتفرق عن أي رفض تاني في طبقة الوصول. */
export function refusal(error: unknown, status: number): unknown {
  return { ...(error as object), status };
}

/**
 * بيجيب صفحة موظفي الخطط (حتى 50) وبيحللها بسكيما العقد قبل ما تلمس الشاشة.
 * فحص القائمة بيبعت سطر واحد بس، فبيمرر الحد من المتصل: 1 للفحص و50 للشاشة.
 *
 * @param scope هوية الشركة والنشاط والمستخدم
 * @param cursor مؤشر الصفحة السابقة أو undefined لأول صفحة
 * @param signal إشارة إلغاء الطلب
 * @param limit أقصى عدد صفوف في الصفحة: واحد لفحص القائمة وخمسين للشاشة
 * @returns صفحة موظفي الخطط بعد تحليلها بسكيما العقد
 */
export async function fetchCommissionPlanEmployees(
  scope: PlanScope,
  cursor: string | undefined,
  signal: AbortSignal,
  limit: 1 | 50 = 50,
): Promise<CommissionPlanEmployeeList> {
  const result = await apiClient().GET(employeesPath, {
    params: {
      header: { 'x-company-id': scope[1] },
      path: { businessId: scope[2] },
      query: { limit, ...(cursor === undefined ? {} : { cursor }) },
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

/** بيجيب أحدث نسخة عادية (من غير نسخ الإصلاح) من السيرفر نفسه، أو null لو مفيش نسخة عادية خالص. */
export async function fetchLatestOrdinaryCommissionPlanVersion(
  scope: PlanScope,
  employeeId: string,
  signal: AbortSignal,
): Promise<CommissionPlanVersion | null> {
  const result = await apiClient().GET(versionsPath, {
    params: {
      header: { 'x-company-id': scope[1] },
      path: { businessId: scope[2], employeeId },
      query: { limit: 1, kind: 'ordinary' },
    },
    signal,
  });
  if (!result.response.ok) throw refusal(result.error ?? {}, result.response.status);
  return commissionPlanVersionList.parse(result.data).items[0] ?? null;
}

/**
 * بيجيب صفحة التصحيحات الموقوفة (حتى 20) بالفلتر المطلوب، من الأحدث للأقدم، وبيحللها بسكيما العقد.
 *
 * @param scope هوية الشركة والنشاط والمستخدم
 * @param status فلتر الحالة: مفتوح أو محلول أو الكل
 * @param cursor مؤشر الصفحة السابقة أو undefined لأول صفحة
 * @param signal إشارة إلغاء الطلب
 * @returns صفحة التصحيحات الموقوفة بعد تحليلها
 */
export async function fetchCommissionBlockedCorrections(
  scope: PlanScope,
  status: CommissionBlockedCorrectionStatus,
  cursor: string | undefined,
  signal: AbortSignal,
): Promise<CommissionBlockedCorrectionList> {
  const result = await apiClient().GET(blockedCorrectionsPath, {
    params: {
      header: { 'x-company-id': scope[1] },
      path: { businessId: scope[2] },
      query: { status, limit: 20, ...(cursor === undefined ? {} : { cursor }) },
    },
    signal,
  });
  if (!result.response.ok) throw refusal(result.error ?? {}, result.response.status);
  return commissionBlockedCorrectionList.parse(result.data);
}

/**
 * بيعمل إصلاح شهر مقفول لموظفة بمفتاح Idempotency ويرجّع النسخة والتصحيح الموقوف بعد تحليلهم بسكيما العقد.
 *
 * @param scope هوية الشركة والنشاط والمستخدم
 * @param employeeId الموظفة
 * @param idempotencyKey مفتاح المحاولة
 * @param body الشهر المحجوز وخطة الإصلاح
 * @returns النسخة المخزّنة وحالة التصحيح الموقوف
 */
export async function createCommissionPeriodRepair(
  scope: PlanScope,
  employeeId: string,
  idempotencyKey: string,
  body: CreateCommissionPeriodRepairInput,
): Promise<CommissionPeriodRepair> {
  const result = await apiClient().POST(periodRepairsPath, {
    params: {
      header: { 'x-company-id': scope[1], 'Idempotency-Key': idempotencyKey },
      path: { businessId: scope[2], employeeId },
    },
    body: body as PeriodRepairWireBody,
  });
  if (!result.response.ok) throw refusal(result.error ?? {}, result.response.status);
  return commissionPeriodRepair.parse(result.data);
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
