'use client';
import type { WorkspaceBusinessRead } from '@pospay/contracts';
import { t, formatDate } from '@pospay/i18n';
import { PageHeader, PageShell } from '@pospay/ui';
import { useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useCreateEmployee } from '../api/use-create-employee';
import { isEmployeeNumberRefusal } from '../model/typed-employee-number';
import { CreateEmployeeForm } from '../ui/create-employee-form';

export function CreateEmployeePage({
  companyId,
  business,
  userId,
}: {
  companyId: string;
  business: WorkspaceBusinessRead;
  userId: string;
}) {
  const locale = useLocale();
  const save = useCreateEmployee(companyId, business.id, userId);
  const [numberShown, setNumberShown] = useState(false);
  const numberSent = save.variables?.employee_number !== undefined;
  const numberRefusal =
    numberShown && save.isError && isEmployeeNumberRefusal(save.error, numberSent);
  return (
    <PageShell layout="form">
      <PageHeader title={t(locale, 'staff.title')} />
      <CreateEmployeeForm
        companyId={companyId}
        businessId={business.id}
        userId={userId}
        branches={business.branches}
        pending={save.isPending}
        serverError={save.isError ? save.error : null}
        numberSent={numberSent}
        onNumberVisibility={setNumberShown}
        onSave={(terms) => save.mutate(terms)}
      />
      {save.isError && !numberRefusal ? (
        <p role="alert">{envelopeMessage(save.error, locale)}</p>
      ) : null}
      {save.isSuccess ? (
        <p role="status">
          {t(locale, 'staff.created')}{' '}
          {locale === 'ar' ? (save.data.name_ar ?? save.data.name_en) : save.data.name_en}
          {' · '}
          {/* يوم التعيين تاريخ مدني؛ UTC هنا للعرض دون إزاحته إلى يوم آخر حسب جهاز المستخدم. */}
          {formatDate(new Date(`${save.data.hire_date}T00:00:00Z`), {
            locale,
            calendar: 'gregorian',
            timeZone: 'UTC',
          })}
        </p>
      ) : null}
    </PageShell>
  );
}
