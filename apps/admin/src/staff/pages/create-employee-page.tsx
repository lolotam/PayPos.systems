'use client';
import type { WorkspaceBusiness } from '@pospay/contracts';
import { t, formatDate } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useCreateEmployee } from '../api/use-create-employee';
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
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-4 text-start">
      <h1 className="text-xl font-semibold">{t(locale, 'staff.title')}</h1>
      <CreateEmployeeForm
        companyId={companyId}
        businessId={business.id}
        branches={business.branches}
        pending={save.isPending}
        onSave={(terms) => save.mutate(terms)}
      />
      {save.isError ? <p role="alert">{envelopeMessage(save.error, locale)}</p> : null}
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
