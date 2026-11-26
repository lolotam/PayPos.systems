'use client';

import type {
  CommissionBlockedCorrection,
  CommissionBlockedCorrectionStatus,
  CommissionPlanEmployeeListItem,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, DataTableFrame, Label, NativeSelect } from '@pospay/ui';
import { useCallback, useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { PlanScope } from '../api/plan-access';
import { useCommissionBlockedCorrections } from '../api/use-commission-blocked-corrections';
import type { PlanAttemptMemory } from '../api/use-save-commission-plan';
import { BlockedCorrectionsTable } from './blocked-corrections-table';
import { commissionPlanEmployeeLabel } from './commission-plan-employee-picker';
import { PeriodRepairDialog } from './period-repair-dialog';

const STATUS_OPTIONS = [
  ['open', 'commissionPlanBuilder.blockedFilterOpen'],
  ['resolved', 'commissionPlanBuilder.blockedFilterResolved'],
  ['all', 'commissionPlanBuilder.blockedFilterAll'],
] as const;

/** فلتر الحالة: مفتوح بالافتراضي لأن الشاشة بتتفتح على اللي محتاج تصليح. */
function StatusFilter({
  status,
  onChange,
}: {
  status: CommissionBlockedCorrectionStatus;
  onChange(status: CommissionBlockedCorrectionStatus): void;
}) {
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="blocked-corrections-status">
        {t(locale, 'commissionPlanBuilder.blockedFilterLabel')}
      </Label>
      <NativeSelect
        id="blocked-corrections-status"
        value={status}
        onChange={(event) => onChange(event.target.value as CommissionBlockedCorrectionStatus)}
      >
        {STATUS_OPTIONS.map(([value, key]) => (
          <option key={value} value={value}>
            {t(locale, key)}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

/** حالات القائمة: تحميل، أو خطأ، أو فاضية (من غير جدول)؛ والجدول نفسه بيظهر لما فيه صفوف بس. */
function BlockedCorrectionsStates({
  query,
  count,
}: {
  query: ReturnType<typeof useCommissionBlockedCorrections>;
  count: number;
}) {
  const locale = useLocale();
  return (
    <>
      {query.isPending ? (
        <p role="status" className="px-4 py-3">
          {t(locale, 'commissionPlanBuilder.blockedLoading')}
        </p>
      ) : null}
      {query.isError ? (
        <p role="alert" className="px-4 py-3">
          {t(
            locale,
            query.isFetchNextPageError
              ? 'commissionPlanBuilder.couldNotLoadMore'
              : 'commissionPlanBuilder.blockedLoadFailed',
          )}
        </p>
      ) : null}
      {query.data !== undefined && count === 0 ? (
        <p className="px-4 py-3">{t(locale, 'commissionPlanBuilder.blockedEmpty')}</p>
      ) : null}
    </>
  );
}

/** زرار تحميل الصفحة التالية. */
function LoadMoreButton({ query }: { query: ReturnType<typeof useCommissionBlockedCorrections> }) {
  const locale = useLocale();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={query.isFetchingNextPage}
      // الإلغاء وقت قفل النطاق بيرفض الوعد، والخطأ نفسه مسجّل في حالة الاستعلام.
      onClick={() => query.fetchNextPage().catch(() => undefined)}
    >
      {t(locale, 'commissionPlanBuilder.loadMore')}
    </Button>
  );
}

/**
 * قسم التصحيحات الموقوفة (FR-049): الفلتر مفتوح بالافتراضي، وجدول بالموظفة والشهر والسبب واللحظات، وزرار
 * «أصلح» للمفتوح بكود NO_PLAN بس (حوار خطة الإصلاح)؛ المفتوح بكود NO_SALARY بيتحل بتسجيل المرتب.
 * اسم الموظفة من الموظفين المحمّلين في الشاشة، وغير المحمّلة بيظهر معرّفها.
 */
export function CommissionBlockedCorrectionsSection({
  scope,
  employees,
  timeZone,
  memory,
}: {
  scope: PlanScope;
  employees: readonly CommissionPlanEmployeeListItem[];
  timeZone: string;
  memory: PlanAttemptMemory;
}) {
  const locale = useLocale();
  const [status, setStatus] = useState<CommissionBlockedCorrectionStatus>('open');
  const [repairing, setRepairing] = useState<CommissionBlockedCorrection | null>(null);
  const query = useCommissionBlockedCorrections(scope, status);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const employeeLabel = useCallback(
    (employeeId: string) => {
      const found = employees.find((employee) => employee.id === employeeId);
      return found === undefined ? employeeId : commissionPlanEmployeeLabel(found, locale);
    },
    [employees, locale],
  );
  return (
    <>
      <DataTableFrame
        stacked
        title={t(locale, 'commissionPlanBuilder.blockedTitle')}
        filters={<StatusFilter status={status} onChange={setStatus} />}
        footer={query.hasNextPage ? <LoadMoreButton query={query} /> : null}
      >
        <BlockedCorrectionsStates query={query} count={items.length} />
        {items.length > 0 ? (
          <BlockedCorrectionsTable
            items={items}
            timeZone={timeZone}
            employeeLabel={employeeLabel}
            onRepair={setRepairing}
          />
        ) : null}
      </DataTableFrame>
      {repairing !== null ? (
        <PeriodRepairDialog
          scope={scope}
          item={repairing}
          employeeLabel={employeeLabel(repairing.employee_id)}
          memory={memory}
          onClose={() => setRepairing(null)}
        />
      ) : null}
    </>
  );
}
