'use client';

import { useMemo } from 'react';

import { planScope, usePlanAccess } from '@/commissions/api/plan-access';
import { useCommissionPlanEmployees } from '@/commissions/api/use-commission-plan-employees';
import { useBusinessIdentityAccess } from '@/business-identity/api/use-business-identity-access';
import { useRatingsAccess } from '@/ratings/api/use-ratings-access';
import { useSessionUser } from '@/session/api/use-session';
import { useAlertRules } from '@/settings/alert-rules/api/use-alert-rules';
import { useRatingSettings } from '@/settings/alert-rules/api/use-rating-settings';
import { useImportedRefunds } from '@/settings/imported-refunds/api/use-imported-refunds';
import { useStaffColumns } from '@/settings/staff-app-columns/api/use-staff-columns';
import { readAccessProof } from '@/shared/api/read-access-proof';
import { useMounted } from '@/shared/browser/use-mounted';
import { useEmployeeAppLink } from '@/staff/api/use-employee-app-link';
import { useLeaveReportAccess } from '@/staff/api/use-leave-report-access';
import { useWorkspace } from '@/workspace/model/workspace-provider';

import type { VisibilityConditions } from './visible-page-ids';

/**
 * يحوّل كل شرط ظهور قديم إلى true أو false باستخدام نفس القراءات التي تستخدمها ملفات
 * *-nav-item.tsx اليوم، بنفس مفاتيح الاستعلام فلا تُرسَل طلبات إضافية.
 * أثناء التحميل أو قبل اختيار نشاط تبقى الشروط مغلقة، فلا تظهر مجموعة فارغة ثم تختفي.
 */
export function useVisibilityConditions(): VisibilityConditions {
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  const ready = workspace.status === 'ready' && workspace.business ? workspace : null;
  const companyId = ready?.company.id;
  const businessId = ready?.business?.id;
  const scope =
    companyId !== undefined && businessId !== undefined && userId !== null
      ? planScope(companyId, businessId, userId)
      : null;
  const alerts = useAlertRules(companyId, userId, businessId);
  const rating = useRatingSettings(companyId, userId, businessId);
  const identity = useBusinessIdentityAccess(companyId, userId, businessId);
  const planAccess = usePlanAccess(scope);
  const planEmployees = useCommissionPlanEmployees(scope);
  const appLink = useEmployeeAppLink(companyId, userId, businessId);
  const refunds = useImportedRefunds(companyId, userId, businessId);
  const leave = useLeaveReportAccess(companyId, businessId, userId);
  const columns = useStaffColumns(companyId, userId, businessId);
  const ratings = useRatingsAccess(companyId, userId, businessId);
  const open = ready !== null && userId !== null;
  const alertsOrRating = open && (alerts.isSuccess || rating.isSuccess);
  // كما في business-identity-nav-item: قراءة فاشلة بعد نجاح سابق تُخفي المدخل حتى لو بقيت data القديمة true.
  const identityAccess = open && !identity.isPending && !identity.isError && identity.data === true;
  const plansAccess = open && planEmployees.data !== undefined && !planAccess.denied;
  const appLinkAccess = open && appLink.isSuccess;
  const refundsAccess = open && readAccessProof(refunds) === 'granted';
  const leaveAccess = open && leave.allowed;
  const columnsAccess = open && !columns.isPending && !columns.isError;
  const ratingsAccess = open && readAccessProof(ratings) === 'granted';
  // دعوات الأعضاء للمالك فقط (spec 076 G1): الدور مأخوذ من العضوية المؤكدة في الـ workspace.
  const invitationsOwner = ready?.company.role_code === 'owner';
  return useMemo(
    () => ({
      always: true,
      'alert-rules-or-rating-access': alertsOrRating,
      'business-identity-access': identityAccess,
      'commission-plans-access': plansAccess,
      'employee-app-link-access': appLinkAccess,
      'imported-refunds-access': refundsAccess,
      'invitations-owner': invitationsOwner,
      'leave-report-access': leaveAccess,
      'ratings-access': ratingsAccess,
      'staff-app-columns-access': columnsAccess,
    }),
    [
      alertsOrRating,
      identityAccess,
      plansAccess,
      appLinkAccess,
      refundsAccess,
      invitationsOwner,
      leaveAccess,
      ratingsAccess,
      columnsAccess,
    ],
  );
}
