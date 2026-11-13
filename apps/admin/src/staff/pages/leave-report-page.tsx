'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { PageHeader } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useLeaveReport } from '../api/use-leave-report';
import { fromHistoryQuery, offeredAbsence } from '../model/leave-history-filters';
import type { LeaveReportScope } from '../model/leave-report-view';
import { LeaveHistoryFiltersForm } from '../ui/leave-history-filters-form';
import { LeaveReportEmployeePicker } from '../ui/leave-report-employee-picker';
import { LeaveReportResults } from '../ui/leave-report-results';

export function LeaveReportPage({
  scope,
  branches,
}: {
  scope: LeaveReportScope;
  branches: WorkspaceBranch[];
}) {
  const locale = useLocale();
  const report = useLeaveReport({ ...scope, branches });
  const [initial] = useState(() => fromHistoryQuery(report.query));
  return (
    <section className="flex flex-col gap-6 text-start">
      <PageHeader title={t(locale, 'leaveHistory.reportTitle')} />
      <LeaveReportEmployeePicker
        companyId={scope.companyId}
        businessId={scope.businessId}
        userId={scope.userId}
        employeeId={report.employeeId}
        onChange={report.chooseEmployee}
      />
      <LeaveHistoryFiltersForm
        initial={initial}
        absenceOffered={offeredAbsence(report.page?.absence_branch_ids ?? [])}
        branches={branches}
        onApply={report.apply}
      />
      <LeaveReportResults view={report} branches={branches} />
    </section>
  );
}
