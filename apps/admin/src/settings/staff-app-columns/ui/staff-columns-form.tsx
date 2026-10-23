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
import { useSaveAttemptKey } from './use-save-attempt-key';
import { useSyncStaffColumnsForm } from './use-sync-staff-columns-form';

type StaffColumnsFormProps = {
  companyId: string;
  userId: string;
  businessId: string;
  server: StaffColumnsSettings;
};

export function StaffColumnsForm({ companyId, userId, businessId, server }: StaffColumnsFormProps) {
  const locale = useLocale();
  const [saved, setSaved] = useState(false);
  const save = useSaveStaffColumns(companyId, userId, businessId);
  const attempt = useSaveAttemptKey();
  const form = useForm<StaffColumnsDraft, unknown, ReplaceStaffColumnsInput>({
    resolver: zodResolver(replaceStaffColumnsInput),
    defaultValues: { columns: [...server.columns], months_back: server.months_back },
  });
  useSyncStaffColumnsForm(form, server);
  const submit = form.handleSubmit((data) => {
    setSaved(false);
    const body = staffColumnsSaveBody(server, data);
    save.mutate(
      { idempotencyKey: attempt.keyFor(body), body },
      {
        onSuccess: (stored) => {
          attempt.forget();
          form.reset({ columns: [...stored.columns], months_back: stored.months_back });
          setSaved(true);
        },
        onError: (error) => attempt.forgetOnKnownError(error),
      },
    );
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-6 text-start">
        {/* أثناء الحفظ بيتقفل كل الحقول: الـ fieldset بيمنع التحرير في المتصفح، والـ disabled على كل مدخل بيوضح إن المدخل مقفول. */}
        <fieldset disabled={save.isPending} className="contents">
          <StaffColumnCheckboxes
            defaultInEffect={server.columns_default}
            disabled={save.isPending}
            error={
              form.formState.errors.columns ? t(locale, 'errors.STAFF_COLUMNS_INVALID') : undefined
            }
          />
          <StaffMonthsBackField
            defaultInEffect={server.months_back_default}
            disabled={save.isPending}
            error={
              form.formState.errors.months_back
                ? t(locale, 'errors.STAFF_MONTHS_BACK_INVALID')
                : undefined
            }
          />
        </fieldset>
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
