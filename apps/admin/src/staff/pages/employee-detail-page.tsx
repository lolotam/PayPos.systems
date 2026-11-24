'use client';
import type { WorkspaceBusinessRead } from '@pospay/contracts';
import { PageShell } from '@pospay/ui';
import { useEmployeeEdit } from '../api/use-employees';
import type { EmployeeDetailTab } from '../model/employee-detail-tabs';
import { EmployeeDetailBody } from '../ui/employee-detail-body';
import { EmployeeDetailHeader } from '../ui/employee-detail-header';
import { EmployeeDetailTabs } from '../ui/employee-detail-tabs';

/**
 * صفحة الموظف بعنوانها: ترويسة ثم صف التبويبات ثم بطاقة التبويب. القالب `form` بعرض 840px لأن
 * الكيت لا يقدم متغير «تفصيل»؛ وقراءة الموظف تُستدعى هنا مرة واحدة وتتشاركها كل التبويبات.
 */
export function EmployeeDetailPage({
  companyId,
  business,
  userId,
  employeeId,
  tab,
}: {
  companyId: string;
  business: WorkspaceBusinessRead;
  userId: string;
  employeeId: string;
  tab: EmployeeDetailTab;
}) {
  const edit = useEmployeeEdit(companyId, business.id, userId, employeeId);
  const { record, save } = edit;
  return (
    <PageShell layout="form">
      <EmployeeDetailHeader
        companyId={companyId}
        businessId={business.id}
        userId={userId}
        employee={record.data && !record.isError ? record.data : undefined}
        busy={save.isPending || record.isFetching}
        onReload={() => {
          save.reset();
          void record.refetch();
        }}
      />
      <EmployeeDetailTabs employeeId={employeeId} current={tab} />
      <EmployeeDetailBody
        tab={tab}
        scope={{ companyId, businessId: business.id, userId, employeeId }}
        business={business}
        edit={edit}
      />
    </PageShell>
  );
}
