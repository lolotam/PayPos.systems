'use client';
import type { WorkspaceBusinessRead } from '@pospay/contracts';
import type { useEmployeeEdit } from '../api/use-employees';
import type { EmployeeDetailTab, EmployeeSectionScope } from '../model/employee-detail-tabs';
import { EmployeeDetailDataTab } from './employee-detail-data-tab';
import { EmployeeDetailDocumentsTab } from './employee-detail-documents-tab';
import { EmployeeDetailHoursTab } from './employee-detail-hours-tab';
import { EmployeeDetailPayTab } from './employee-detail-pay-tab';
import { EmployeeLeaveSection } from './employee-leave-section';

/** أقسام التبويب الحالي؛ تبويب «الإجازات» ينتظر انتهاء القراءة فقط، وبقية التبويبات تتطلّب السجل. */
export function EmployeeDetailTabContent({
  tab,
  scope,
  business,
  edit,
}: {
  tab: EmployeeDetailTab;
  scope: EmployeeSectionScope;
  business: WorkspaceBusinessRead;
  edit: ReturnType<typeof useEmployeeEdit>;
}) {
  const employee = edit.record.data && !edit.record.isError ? edit.record.data : undefined;
  const timeZone = business.branches.find(
    (branch) => branch.id === employee?.primary_branch_id,
  )?.effective_timezone;
  if (tab === 'leave') {
    if (edit.record.isPending) return null;
    return <EmployeeLeaveSection {...scope} branches={business.branches} timeZone={timeZone} />;
  }
  if (!employee) return null;
  // TODO(spec) SS-Q2: الوصول هنا يتطلب manage:employees:business؛ مدخل مستقل لمفوّض الرواتب ينتظر قرار المالك.
  if (tab === 'pay') return <EmployeeDetailPayTab scope={scope} timeZone={timeZone} />;
  if (tab === 'hours') return <EmployeeDetailHoursTab scope={scope} />;
  if (tab === 'documents') return <EmployeeDetailDocumentsTab scope={scope} />;
  return (
    <EmployeeDetailDataTab
      companyId={scope.companyId}
      business={business}
      employee={employee}
      save={edit.save}
    />
  );
}
