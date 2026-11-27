import type { CommissionBlockedCorrection } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { stampDate } from './plan-history-columns';

/** ما بتحتاجه الأعمدة من برا: اسم الموظفة من المعرّف، وفتح حوار الإصلاح. */
export interface BlockedCorrectionColumnOptions {
  locale: Locale;
  timeZone: string;
  employeeLabel(employeeId: string): string;
  onRepair(item: CommissionBlockedCorrection): void;
}

/**
 * خلية الإجراء: تصحيح مفتوح بكود NO_PLAN بيفتح الإصلاح، وبكود NO_SALARY بيشرح إن تسجيل المرتب هو اللي بيحله
 * (مفيش إصلاح بخطة، CM-53)، والمحلول مالوش إجراء.
 */
function actionCell(item: CommissionBlockedCorrection, options: BlockedCorrectionColumnOptions) {
  if (item.resolved_at !== null) return null;
  if (item.code === 'NO_SALARY')
    return <span>{t(options.locale, 'commissionPlanBuilder.blockedSalaryNote')}</span>;
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => options.onRepair(item)}>
      {t(options.locale, 'commissionPlanBuilder.blockedRepair')}
    </Button>
  );
}

/** أعمدة جدول التصحيحات الموقوفة: الموظفة والشهر الموقوف والسبب والشهر المحجوز ولحظتا التسجيل والحل والإجراء. */
export function blockedCorrectionColumns(
  options: BlockedCorrectionColumnOptions,
): ColumnDef<CommissionBlockedCorrection>[] {
  const { locale, timeZone } = options;
  return [
    {
      id: 'employee',
      header: t(locale, 'commissionPlanBuilder.blockedColEmployee'),
      cell: ({ row }) => options.employeeLabel(row.original.employee_id),
    },
    {
      id: 'sourcePeriod',
      header: t(locale, 'commissionPlanBuilder.blockedColSourcePeriod'),
      cell: ({ row }) => <span dir="ltr">{row.original.source_period}</span>,
    },
    {
      id: 'code',
      header: t(locale, 'commissionPlanBuilder.blockedColCode'),
      cell: ({ row }) =>
        t(
          locale,
          row.original.code === 'NO_PLAN'
            ? 'commissionPlanBuilder.blockedCodeNoPlan'
            : 'commissionPlanBuilder.blockedCodeNoSalary',
        ),
    },
    {
      id: 'targetPeriod',
      header: t(locale, 'commissionPlanBuilder.blockedColTargetPeriod'),
      cell: ({ row }) => <span dir="ltr">{row.original.target_period}</span>,
    },
    {
      id: 'createdAt',
      header: t(locale, 'commissionPlanBuilder.blockedColCreatedAt'),
      cell: ({ row }) => stampDate(row.original.created_at, locale, timeZone),
    },
    {
      id: 'resolvedAt',
      header: t(locale, 'commissionPlanBuilder.blockedColResolvedAt'),
      cell: ({ row }) =>
        row.original.resolved_at === null ? '—' : stampDate(row.original.resolved_at, locale, timeZone),
    },
    {
      id: 'action',
      header: t(locale, 'commissionPlanBuilder.blockedColAction'),
      cell: ({ row }) => actionCell(row.original, options),
    },
  ];
}
