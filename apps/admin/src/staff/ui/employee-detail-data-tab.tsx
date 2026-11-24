'use client';
import type { EmployeeDetail, WorkspaceBusinessRead } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import type { useEmployeeEdit } from '../api/use-employees';
import { EditEmployeeForm } from './edit-employee-form';
import { EmployeeAccessSection } from './employee-access-section';

/** تبويب «البيانات»: نموذج التعديل برسالتي الحفظ، ثم قسم دخول الموظف. */
export function EmployeeDetailDataTab({
  companyId,
  business,
  employee,
  save,
}: {
  companyId: string;
  business: WorkspaceBusinessRead;
  employee: EmployeeDetail;
  save: ReturnType<typeof useEmployeeEdit>['save'];
}) {
  const locale = useLocale();
  return (
    <>
      <EditEmployeeForm
        {...{ companyId, businessId: business.id, record: employee }}
        key={`${employee.id}:${employee.revision}`}
        branches={business.branches}
        pending={save.isPending}
        onSave={(terms) => save.mutate(terms)}
      />
      {save.isError ? <p role="alert">{envelopeMessage(save.error, locale)}</p> : null}
      {save.isSuccess ? <p role="status">{t(locale, 'staff.saved')}</p> : null}
      <EmployeeAccessSection
        companyId={companyId}
        businessId={business.id}
        employeeId={employee.id}
      />
    </>
  );
}
