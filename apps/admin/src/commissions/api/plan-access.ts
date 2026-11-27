'use client';

import type { CommissionBlockedCorrectionStatus } from '@pospay/contracts';
import { useQuery, type QueryClient } from '@tanstack/react-query';

/** نطاق هوية واحدة: كل مفاتيح الشاشة بتبدأ بيه عشان البيانات والوصول يفضلوا لكل هوية على حدة. */
export type PlanScope = readonly ['commission-plans', string, string, string];

export function planScope(companyId: string, businessId: string, userId: string): PlanScope {
  return ['commission-plans', companyId, businessId, userId] as const;
}

/** حالة وصول الهوية: مقفول بعد أول 403، والجيل بيتazen مع كل تغيير عشان الردود المتأخرة تتاهمل. */
export interface PlanAccessState {
  denied: boolean;
  generation: number;
}

const INITIAL_ACCESS: PlanAccessState = { denied: false, generation: 0 };

export function planEmployeesKey(scope: PlanScope) {
  return [...scope, 'employees'] as const;
}

/**
 * مفتاح فحص القائمة: بيعيش تحت مفتاح الموظفين، فإزالة مفتاح الموظفين في قفل الوصول
 * بتمسح الفحص كمان من غير سطر زيادة.
 */
export function planProbeKey(scope: PlanScope) {
  return [...planEmployeesKey(scope), 'probe'] as const;
}

export function planVersionsKey(scope: PlanScope, employeeId: string) {
  return [...scope, 'versions', employeeId] as const;
}

/** مفتاح قراءة أحدث نسخة عادية للمحرّر: خارج مفتاح التاريخ عشان إضافة النسخة الجديدة للتاريخ ما تلمسوش. */
export function planSeedKey(scope: PlanScope, employeeId: string) {
  return [...scope, 'seed-version', employeeId] as const;
}

/** مفتاح جدول خدمات الشاشة: خدمات النشاط مع التجاوز الحالي لكل خدمة. */
export function planOverrideServicesKey(scope: PlanScope, employeeId: string) {
  return [...scope, 'override-services', employeeId] as const;
}

/** مفتاح تاريخ التجاوزات: سطور خدمة واحدة للموظفة، الأحدث في الأول. */
export function planOverrideHistoryKey(scope: PlanScope, employeeId: string, serviceId: string) {
  return [...scope, 'override-history', employeeId, serviceId] as const;
}

/**
 * مفتاح قائمة التصحيحات الموقوفة: بيعيش تحت النطاق فقفل الوصول بيمسحه، والفلتر جزء منه عشان كل حالة تاخد كاشها؛
 * من غير حالة بيطابق كل الفلاتر (للإبطال بعد الإصلاح).
 */
export function planBlockedCorrectionsKey(scope: PlanScope, status?: CommissionBlockedCorrectionStatus) {
  return [...scope, 'blocked-corrections', ...(status === undefined ? [] : [status])] as const;
}

function planAccessKey(scope: PlanScope) {
  return [...scope, 'access'] as const;
}

/** بيقرا الجيل الحالي من الكاش لحظة بدء الطلب عشان نعرف بعدها إن الرد بقى متأخر. */
export function planGeneration(client: QueryClient, scope: PlanScope): number {
  return (client.getQueryData<PlanAccessState>(planAccessKey(scope)) ?? INITIAL_ACCESS).generation;
}

/**
 * بيقفل نطاق الهوية عند أول 403: بيرفع الجيل الأول عشان كل اللي بيشوفه يتوقف، ويلغي الجلب الشغّال،
 * ويمسح بيانات القوائم. مفيش إعادة جلب تلقائية: الاستعلامات معطّلة والدنيا بترجع بس بزرار «جرّب تاني».
 * الإلغاء بلا revert: النطاق سابق لمفتاح الوصول نفسه، وrevert الافتراضي بيرجّع حالة الاستعلام للخلف
 * ويمسح الإنكار المكتوب للتو، والإلغاء من غيره بيمنع جلب الوصول يكتب فوق الإنكار لما يخلص.
 */
export async function denyPlanAccess(client: QueryClient, scope: PlanScope): Promise<void> {
  client.setQueryData<PlanAccessState>(planAccessKey(scope), {
    denied: true,
    generation: planGeneration(client, scope) + 1,
  });
  await client.cancelQueries({ queryKey: scope }, { revert: false });
  client.removeQueries({ queryKey: planEmployeesKey(scope) });
  client.removeQueries({ queryKey: [...scope, 'versions'] });
  client.removeQueries({ queryKey: [...scope, 'seed-version'] });
  client.removeQueries({ queryKey: [...scope, 'override-services'] });
  client.removeQueries({ queryKey: [...scope, 'override-history'] });
  client.removeQueries({ queryKey: planBlockedCorrectionsKey(scope) });
}

/** بيرجّع الوصول بجيل جديد من غير أي بيانات: أول صفحة موظفين ناجحة في الجيل الجديد بس هي اللي بتظهر. */
export function restorePlanAccess(client: QueryClient, scope: PlanScope): void {
  client.setQueryData<PlanAccessState>(planAccessKey(scope), {
    denied: false,
    generation: planGeneration(client, scope) + 1,
  });
}

/** اشتراك مشترك في حالة الوصول عشان عنصر القائمة والصفحة يقراو نفس القيمة ما يتفرقشوا. */
export function usePlanAccess(scope: PlanScope | null): PlanAccessState {
  const query = useQuery({
    queryKey: planAccessKey(scope ?? planScope('', '', '')),
    queryFn: () => INITIAL_ACCESS,
    enabled: scope !== null,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  return query.data ?? INITIAL_ACCESS;
}

function planStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

/** 403 في أي قائمة أو قراءة نسخ أو حفظ بيقفل النطاق كله. */
export function isPlanForbidden(error: unknown): boolean {
  return planStatus(error) === 403;
}

/** 404 الموظفة محلي بس: بيتشال قيدها وما بيلمسش القائمة ولا الوصول. */
export function isPlanNotFound(error: unknown): boolean {
  return planStatus(error) === 404;
}

/** 503 كيرسور الموظفين: بيانات محفوظة محتاجة إصلاح، فله رسالته الخاصة مش الفاضية ولا خطأ عابر. */
export function isCursorUnavailable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'COMMISSION_PLAN_EMPLOYEE_CURSOR_UNAVAILABLE'
  );
}
