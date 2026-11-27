'use client';

import type { CommissionBlockedCorrection, CommissionPeriodRepair } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { ModalDialog } from '@/shared/ui/modal-dialog';
import type { PlanScope } from '../api/plan-access';
import { useRepairCommissionPeriod } from '../api/use-repair-commission-period';
import type { PlanAttemptMemory } from '../api/use-save-commission-plan';
import { PeriodRepairForm } from './period-repair-form';

/** نص نتيجة الإصلاح: محلول، أو الخطة اتحفظت والتصحيح بقى مستني مرتب (NO_SALARY، CM-52b). */
function outcomeMessage(result: CommissionPeriodRepair, locale: Locale): string {
  return result.blocked_correction.resolved
    ? t(locale, 'commissionPlanBuilder.repairResolved')
    : t(locale, 'commissionPlanBuilder.repairNoSalary');
}

/**
 * حوار إصلاح شهر مقفول لتصحيح موقوف بكود NO_PLAN: بيعرض الموظفة والشهر ونموذج الخطة بالبلوكات التلاتة
 * بس، وبعد النجاح بيستبدل النموذج بنتيجة واضحة (اتحل، أو الخطة اتحفظت والتصحيح مستني مرتب) وزرار قفل.
 */
export function PeriodRepairDialog(props: {
  scope: PlanScope;
  item: CommissionBlockedCorrection;
  employeeLabel: string;
  memory: PlanAttemptMemory;
  onClose(): void;
}) {
  const { scope, item, employeeLabel, memory, onClose } = props;
  const locale = useLocale();
  const repair = useRepairCommissionPeriod(scope, memory);
  return (
    <ModalDialog
      title={t(locale, 'commissionPlanBuilder.repairTitle')}
      pending={repair.isPending}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-2">
          <dt className="text-muted-foreground">{t(locale, 'commissionPlanBuilder.repairEmployee')}</dt>
          <dd className="font-semibold">{employeeLabel}</dd>
          <dt className="text-muted-foreground">{t(locale, 'commissionPlanBuilder.repairMonth')}</dt>
          <dd dir="ltr" className="text-start font-semibold">{item.source_period}</dd>
        </dl>
        {repair.data !== undefined ? (
          <>
            <p role="status">{outcomeMessage(repair.data, locale)}</p>
            <Button type="button" onClick={onClose}>
              {t(locale, 'commissionPlanBuilder.repairClose')}
            </Button>
          </>
        ) : (
          <PeriodRepairForm
            pending={repair.isPending}
            serverError={repair.error}
            onClose={onClose}
            onSubmit={(plan) =>
              repair.mutate({ employeeId: item.employee_id, body: { period: item.source_period, plan } })
            }
          />
        )}
      </div>
    </ModalDialog>
  );
}
