'use client';

import { planScope, restorePlanAccess, usePlanAccess } from '../api/plan-access';
import { useOverrideAttemptMemory } from '../api/use-save-commission-override';
import { t } from '@pospay/i18n';
import { PageHeader, PageShell } from '@pospay/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { CommissionOverridesSection } from '../ui/commission-overrides-section';
import { CommissionPlansBoard } from '../ui/commission-plans-board';
import { CommissionPlansDenied } from '../ui/commission-plans-denied';

type CommissionOverridesPageProps = { companyId: string; userId: string; businessId: string };

/**
 * شاشة العمولة الخاصة لكل خدمة: نفس قواعد الوصول بتاعة شاشة الخطط (أول 403 في أي قراءة أو
 * حفظ بيقفل النطاق كله)، وذاكرة محاولة الحفظ بتعيش هنا فتبقى مع الخدمة حتى بعد ما الحوار يتقفل.
 */
export function CommissionOverridesPage({ companyId, userId, businessId }: CommissionOverridesPageProps) {
  const locale = useLocale();
  const client = useQueryClient();
  const scope = planScope(companyId, businessId, userId);
  const access = usePlanAccess(scope);
  const memory = useOverrideAttemptMemory();
  useEffect(() => {
    if (access.denied) memory.current.clear();
  }, [access.denied, memory]);
  return (
    <PageShell layout="list">
      <PageHeader title={t(locale, 'commissionOverrides.pageTitle')} />
      {access.denied ? (
        <CommissionPlansDenied onRetry={() => restorePlanAccess(client, scope)} />
      ) : (
        <CommissionPlansBoard
          scope={scope}
          renderSection={(s) => (
            <CommissionOverridesSection key={s.employee.id} scope={scope} {...s} memory={memory} />
          )}
        />
      )}
    </PageShell>
  );
}
