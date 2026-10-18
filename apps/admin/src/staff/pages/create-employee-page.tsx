'use client';
import type { WorkspaceBusiness } from '@pospay/contracts';
import { t, formatDate } from '@pospay/i18n';
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
  business: WorkspaceBusiness;
  userId: string;
}) {
  const locale = useLocale();
  const save = useCreateEmployee(companyId, business.id, userId);
  const [numberShown, setNumberShown] = useState(false);
  const numberRefusal = numberShown && save.isError && isEmployeeNumberRefusal(save.error);
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-4 text-start">
      <h1 className="text-xl font-semibold">{t(locale, 'staff.title')}</h1>
      <CreateEmployeeForm
        companyId={companyId}
        businessId={business.id}
        userId={userId}
        branches={business.branches}
        pending={save.isPending}
        serverError={save.isError ? save.error : null}
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
    </section>
  );
}
