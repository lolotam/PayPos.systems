'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createCompanyInput, type CreateCompanyInput } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import type { FieldError } from 'react-hook-form';

import { useLocale } from '@/shared/locale/locale-context';

import { PROVISIONAL_PLAN_ID } from '../model/provisional-plan';
import { CompanyNameField } from './create-company-field';

function nameErrorKey(issue: FieldError | undefined, empty: boolean): MessageKey | undefined {
  if (!issue) return undefined;
  return empty ? 'admin.nameEnRequired' : 'admin.nameTooLong';
}

function tooLong(field: 'name_en' | 'name_ar', serverField: 'name_en' | 'name_ar' | null) {
  return field === serverField ? ('admin.nameTooLong' as const) : undefined;
}

// الاسم العربي الفاضي بيتحوّل لغياب قبل ما يتخزن عشان سكيما العقد الاختيارية تقبله،
// والفراغات بترجع undefined زي ما هي.
const omitEmptyArabic = (value: string) => {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export function CreateCompanyForm({
  pending,
  locked,
  lockedBody,
  serverField,
  onSave,
  onRetry,
}: {
  pending: boolean;
  locked: boolean;
  lockedBody: CreateCompanyInput | null;
  serverField: 'name_en' | 'name_ar' | null;
  onSave: (input: CreateCompanyInput) => void;
  onRetry: () => void;
}) {
  const locale = useLocale();
  const form = useForm<CreateCompanyInput>({
    resolver: zodResolver(createCompanyInput),
    defaultValues: { name_en: '', name_ar: undefined, plan_id: PROVISIONAL_PLAN_ID },
  });
  // والمحاولة غير المحسومة بتعرض قيمها المخزّنة للقراءة فقط، وفي نفس المحاولة بعد رفض قاطع
  // القيم بتفضل زي ما كانت في النموذج القابل للتحرير.
  useEffect(() => {
    if (locked && lockedBody !== null) form.reset(lockedBody);
  }, [form, locked, lockedBody]);
  const errors = form.formState.errors;
  const values = form.getValues();
  const enError = nameErrorKey(errors.name_en, values.name_en.trim() === '') ?? tooLong('name_en', serverField);
  const arError = (errors.name_ar ? 'admin.nameTooLong' : undefined) ?? tooLong('name_ar', serverField);
  return (
    <form noValidate className="flex flex-col gap-4 text-start" onSubmit={form.handleSubmit(onSave)}>
      <fieldset disabled={pending} className="contents">
        <CompanyNameField
          id="company-name-en"
          label="admin.companyNameEnLabel"
          error={enError}
          readOnly={locked}
          disabled={pending}
          {...form.register('name_en')}
        />
        <CompanyNameField
          id="company-name-ar"
          label="admin.companyNameArLabel"
          error={arError}
          readOnly={locked}
          disabled={pending}
          {...form.register('name_ar', { setValueAs: omitEmptyArabic })}
        />
        {locked ? (
          <Button type="button" onClick={onRetry} disabled={pending}>
            {t(locale, 'admin.createCompanyRetry')}
          </Button>
        ) : (
          <Button type="submit" disabled={pending}>
            {t(locale, 'admin.createCompanySubmit')}
          </Button>
        )}
      </fieldset>
    </form>
  );
}
