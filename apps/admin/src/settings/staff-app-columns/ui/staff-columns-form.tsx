'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  replaceStaffColumnsInput,
  type ReplaceStaffColumnsInput,
  type StaffColumnsSettings,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { useSaveStaffColumns } from '../api/use-save-staff-columns';
import { staffColumnsFailureMessage } from '../model/staff-columns-failure';
import { staffColumnsSaveBody, type StaffColumnsDraft } from '../model/staff-columns-save-body';
import { StaffColumnCheckboxes } from './staff-column-checkboxes';
import { StaffMonthsBackField } from './staff-months-back-field';

export function StaffColumnsForm({
  companyId,
  userId,
  businessId,
  server,
}: {
  companyId: string;
  userId: string;
  businessId: string;
  server: StaffColumnsSettings;
}) {
  const locale = useLocale();
  const [saved, setSaved] = useState(false);
  const save = useSaveStaffColumns(companyId, userId, businessId);
  const form = useForm<StaffColumnsDraft, unknown, ReplaceStaffColumnsInput>({
    resolver: zodResolver(replaceStaffColumnsInput),
    defaultValues: { columns: [...server.columns], months_back: server.months_back },
  });
  const submit = form.handleSubmit((data) => {
    setSaved(false);
    save.mutate(
      { idempotencyKey: crypto.randomUUID(), body: staffColumnsSaveBody(server, data) },
      {
        onSuccess: (stored) => {
          form.reset({ columns: [...stored.columns], months_back: stored.months_back });
          setSaved(true);
        },
      },
    );
  });
  const invalid = Object.keys(form.formState.errors).length > 0;
  return (
    <FormProvider {...form}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-6 text-start">
        {/* أثناء الحفظ بيتقفل كل الحقول: الـ fieldset بيمنع التحرير في المتصفح، والـ disabled على كل مدخل بيوضح إن المدخل مقفول. */}
        <fieldset disabled={save.isPending} className="contents">
          <StaffColumnCheckboxes
            defaultInEffect={server.columns_default}
            disabled={save.isPending}
          />
          <StaffMonthsBackField
            defaultInEffect={server.months_back_default}
            disabled={save.isPending}
          />
        </fieldset>
        {invalid ? <p role="alert">{t(locale, 'errors.STAFF_MONTHS_BACK_INVALID')}</p> : null}
        {save.isError ? <p role="alert">{staffColumnsFailureMessage(save.error, locale)}</p> : null}
        {save.isPending ? <p role="status">{t(locale, 'staffAppColumns.saving')}</p> : null}
        {saved && !form.formState.isDirty ? (
          <p role="status">{t(locale, 'staffAppColumns.saved')}</p>
        ) : null}
        <Button type="submit" disabled={save.isPending}>
          {t(locale, 'staffAppColumns.save')}
        </Button>
      </form>
    </FormProvider>
  );
}
