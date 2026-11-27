'use client';

import { planScope, restorePlanAccess, usePlanAccess } from '../api/plan-access';
import { usePlanAttemptMemory } from '../api/use-save-commission-plan';
import { t } from '@pospay/i18n';
import { PageHeader, PageShell } from '@pospay/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { CommissionPlanSection } from '../ui/commission-plan-section';
import { CommissionPlansBoard, type PlanBoardSelection } from '../ui/commission-plans-board';
import { CommissionPlansDenied } from '../ui/commission-plans-denied';

/**
 * شاشة منشئ خطة العمولة لهوية واحدة: أول 403 في أي قائمة أو قراءة أو حفظ بيقفل النطاق كله
 * من غير إعادة طلب، واللجنة بتاعته بتفصل فالاختيار القديم بيضيع، والرجوع بزرار «جرّب تاني» بجيل جديد.
 */
export function CommissionPlansPage({
  companyId,
  userId,
  businessId,
}: {
  companyId: string;
  userId: string;
  businessId: string;
}) {
  const locale = useLocale();
  const client = useQueryClient();
  const scope = planScope(companyId, businessId, userId);
  const access = usePlanAccess(scope);
  const memory = usePlanAttemptMemory();
  useEffect(() => {
    if (access.denied) memory.current.clear();
  }, [access.denied, memory]);
  const renderSection = (selection: PlanBoardSelection) => (
    <CommissionPlanSection key={selection.employee.id} scope={scope} {...selection} memory={memory} />
  );
  return (
    <PageShell layout="list">
      <PageHeader title={t(locale, 'commissionPlanBuilder.pageTitle')} />
      {access.denied ? (
        <CommissionPlansDenied onRetry={() => restorePlanAccess(client, scope)} />
      ) : (
        <CommissionPlansBoard scope={scope} renderSection={renderSection} memory={memory} />
      )}
    </PageShell>
  );
}
