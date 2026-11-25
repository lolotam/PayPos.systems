'use client';

import { planScope, usePlanAccess } from '@/commissions/api/plan-access';
import { useCommissionPlanEmployees } from '@/commissions/api/use-commission-plan-employees';
import { useBusinessIdentityAccess } from '@/business-identity/api/use-business-identity-access';
import { useAlertRules } from '@/settings/alert-rules/api/use-alert-rules';
import { useRatingSettings } from '@/settings/alert-rules/api/use-rating-settings';
import { useRatingsAccess } from '@/ratings/api/use-ratings-access';
import { useImportedRefunds } from '@/settings/imported-refunds/api/use-imported-refunds';
import { useStaffColumns } from '@/settings/staff-app-columns/api/use-staff-columns';
import { useEmployeeAppLink } from '@/staff/api/use-employee-app-link';
import { useLeaveReportAccess } from '@/staff/api/use-leave-report-access';
import { useWorkspace } from '@/workspace/model/workspace-provider';

/** القراءات خلف شروط الظهور القديمة كما هي، ومعها هل المستخدم والنشاط معروفان فتكون القراءات مفتوحة. */
export interface VisibilityReads {
  open: boolean;
  alerts: ReturnType<typeof useAlertRules>;
  rating: ReturnType<typeof useRatingSettings>;
  identity: ReturnType<typeof useBusinessIdentityAccess>;
  planAccess: ReturnType<typeof usePlanAccess>;
  planEmployees: ReturnType<typeof useCommissionPlanEmployees>;
  appLink: ReturnType<typeof useEmployeeAppLink>;
  refunds: ReturnType<typeof useImportedRefunds>;
  ratings: ReturnType<typeof useRatingsAccess>;
  leave: ReturnType<typeof useLeaveReportAccess>;
  columns: ReturnType<typeof useStaffColumns>;
}

/**
 * يستدعي قراءات شروط الظهور بنفس مفاتيح الاستعلام التي تستخدمها الشاشات فلا تُرسَل طلبات إضافية.
 * القراءات تعمل فقط حين تكون مساحة العمل جاهزة بنشاط مختار والمستخدم معروف.
 *
 * @param userId معرّف المستخدم المسجّل أو null قبل أن تُقرأ هويته
 * @returns حالة كل قراءة، و`open` حين تكون كلها مفتوحة للعمل
 */
export function useVisibilityReads(userId: string | null): VisibilityReads {
  const workspace = useWorkspace();
  const ready = workspace.status === 'ready' && workspace.business ? workspace : null;
  const companyId = ready?.company.id;
  const businessId = ready?.business?.id;
  const scope =
    companyId !== undefined && businessId !== undefined && userId !== null
      ? planScope(companyId, businessId, userId)
      : null;
  return {
    open: ready !== null && userId !== null,
    alerts: useAlertRules(companyId, userId, businessId),
    rating: useRatingSettings(companyId, userId, businessId),
    identity: useBusinessIdentityAccess(companyId, userId, businessId),
    planAccess: usePlanAccess(scope),
    planEmployees: useCommissionPlanEmployees(scope, { probe: true }),
    appLink: useEmployeeAppLink(companyId, userId, businessId),
    refunds: useImportedRefunds(companyId, userId, businessId),
    ratings: useRatingsAccess(companyId, userId, businessId),
    leave: useLeaveReportAccess(companyId, businessId, userId),
    columns: useStaffColumns(companyId, userId, businessId),
  };
}
